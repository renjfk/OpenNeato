#include "notification_manager.h"
#include "neato_serial.h"
#include "settings_manager.h"
#include "data_logger.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#define NTFY_DEFAULT_HOST "ntfy.sh"
#define NTFY_CONNECT_TIMEOUT_MS 3000

NotificationManager::NotificationManager(NeatoSerial& neato, SettingsManager& settings, DataLogger& logger) :
    LoopTask(NOTIF_INTERVAL_IDLE_MS), neato(neato), settings(settings), dataLogger(logger) {
    TaskRegistry::add(this);
}

void NotificationManager::begin() {
    LOG("NOTIF", "Notification manager initialized");
}

void NotificationManager::tick() {
    if (fetchPending)
        return;

    // Skip if notifications disabled, no topic configured, or WiFi not connected
    const Settings& s = settings.get();
    if (!s.ntfyEnabled || s.ntfyTopic.isEmpty() || WiFi.status() != WL_CONNECTED)
        return;

    checkTransitions();
}

void NotificationManager::checkTransitions() {
    fetchPending = true;

    // Fetch state first, then error — both return from cache (zero serial cost within TTL)
    neato.getState([this](bool stateOk, const RobotState& state) {
        neato.getErr([this, stateOk, state](bool errOk, const ErrorData& err) {
            fetchPending = false;

            const Settings& cfg = settings.get();
            const String& topic = cfg.ntfyTopic;
            const String& hostname = cfg.hostname;

            if (stateOk) {
                const String& ui = state.uiState;
                const String& rs = state.robotState;

                // Detect transitions
                if (!prevUiState.isEmpty()) {
                    bool wasCleaning = prevUiState.indexOf("CLEANINGRUNNING") >= 0;
                    bool wasDocking = prevUiState.indexOf("DOCKING") >= 0;
                    bool isDocking = ui.indexOf("DOCKING") >= 0;
                    bool isSuspended = ui.indexOf("CLEANINGSUSPENDED") >= 0;
                    bool isIdle = ui == "UIMGR_STATE_IDLE" || ui == "UIMGR_STATE_STANDBY";

                    // Track cleaning context when entering docking
                    if (wasCleaning && isDocking) {
                        wasCleaningBeforeDock = true;
                    }

                    // Mid-clean recharge: robot state ST_M1_Charging_Cleaning means
                    // the robot docked to recharge and will resume cleaning afterwards.
                    // The UI state transitions DOCKING -> CLEANINGSUSPENDED once on the dock.
                    bool isRecharging = rs.indexOf("Charging_Cleaning") >= 0;

                    if (isDocking && !wasDocking && isRecharging && cfg.ntfyOnDocking) {
                        // Recharge dock — robot will resume cleaning after charging
                        sendNotification(topic, "electric_plug", hostname + ": Returning to base to recharge");
                    }

                    // Cleaning completed: cleaning/docking -> idle, but NOT if it's a recharge.
                    // Also handle suspended -> idle (user stops clean while recharging).
                    bool dockingDone = wasDocking && wasCleaningBeforeDock && !isRecharging;
                    bool suspendedDone = (prevUiState.indexOf("CLEANINGSUSPENDED") >= 0) && wasCleaningBeforeDock;
                    if ((wasCleaning || dockingDone || suspendedDone) && isIdle && cfg.ntfyOnDone) {
                        sendNotification(topic, "white_check_mark", hostname + ": Cleaning done");
                    }

                    // Clear tracking flag when leaving docking — but preserve it
                    // through DOCKING -> CLEANINGSUSPENDED (mid-clean recharge)
                    if (wasDocking && !isDocking && !isSuspended) {
                        wasCleaningBeforeDock = false;
                    }
                }

                // Update adaptive interval based on current state
                bool active = isActiveState(ui);
                setInterval(active ? NOTIF_INTERVAL_ACTIVE_MS : NOTIF_INTERVAL_IDLE_MS);
                prevUiState = ui;
                prevRobotState = rs;
            }

            if (errOk) {
                // New error or alert detected: was no error -> now has error, or code changed
                if (err.hasError && (!prevHasError || err.errorCode != prevErrorCode)) {
                    bool isAlert = (err.kind == "warning"); // UI_ALERT_* (201-242)
                    bool allowed = isAlert ? cfg.ntfyOnAlert : cfg.ntfyOnError;
                    if (allowed) {
                        String tag = isAlert ? "information_source" : "warning";
                        sendNotification(topic, tag, hostname + ": " + err.displayMessage);
                    }
                }
                prevHasError = err.hasError;
                prevErrorCode = err.errorCode;
            }
        });
    });
}

bool NotificationManager::isActiveState(const String& uiState) {
    return uiState.indexOf("CLEANINGRUNNING") >= 0 || uiState.indexOf("CLEANINGPAUSED") >= 0 ||
           uiState.indexOf("CLEANINGSUSPENDED") >= 0 || uiState.indexOf("DOCKING") >= 0;
}

void NotificationManager::sendNotification(const String& topic, const String& tags, const String& message) {
    LOG("NOTIF", "Sending: [%s] %s", tags.c_str(), message.c_str());

    const Settings& cfg = settings.get();
    String host = cfg.ntfyServer.isEmpty() ? NTFY_DEFAULT_HOST : cfg.ntfyServer;
    bool useHttps = !cfg.ntfyServer.isEmpty(); // Custom servers use HTTPS; ntfy.sh uses plain HTTP

    WiFiClientSecure secureClient;
    WiFiClient plainClient;
    Client* client;

    if (useHttps) {
        secureClient.setInsecure(); // Skip cert validation — self-hosted server
        secureClient.setTimeout(NTFY_CONNECT_TIMEOUT_MS);
        if (!secureClient.connect(host.c_str(), 443)) {
            LOG("NOTIF", "TLS connect to %s:443 failed", host.c_str());
            dataLogger.logNotification("notif_send_fail", message, false);
            return;
        }
        client = &secureClient;
    } else {
        plainClient.setTimeout(NTFY_CONNECT_TIMEOUT_MS);
        if (!plainClient.connect(host.c_str(), 80)) {
            LOG("NOTIF", "Connect to %s:80 failed", host.c_str());
            dataLogger.logNotification("notif_send_fail", message, false);
            return;
        }
        client = &plainClient;
    }

    // Build HTTP POST request
    client->print("POST /" + topic + " HTTP/1.1\r\n");
    client->print("Host: " + host + "\r\n");
    client->print("Content-Type: text/plain\r\n");
    client->print("Tags: " + tags + "\r\n");
    client->print("Content-Length: " + String(message.length()) + "\r\n");
    if (!cfg.ntfyToken.isEmpty()) {
        client->print("Authorization: Bearer " + cfg.ntfyToken + "\r\n");
    }
    client->print("Connection: close\r\n");
    client->print("\r\n");
    client->print(message);

    // Read just the HTTP status line (e.g. "HTTP/1.1 200 OK\r\n")
    bool ok = false;
    String statusLine = client->readStringUntil('\n');
    if (statusLine.length() > 0) {
        int spaceIdx = statusLine.indexOf(' ');
        if (spaceIdx > 0) {
            int code = statusLine.substring(spaceIdx + 1, spaceIdx + 4).toInt();
            ok = (code >= 200 && code < 300);
            LOG("NOTIF", "Response: %d %s", code, ok ? "OK" : "FAIL");
        }
    }

    client->stop();

    dataLogger.logNotification("notif_sent", message, ok);
}

void NotificationManager::sendTestNotification(const String& topic) {
    const String& hostname = settings.get().hostname;
    sendNotification(topic, "bell", hostname + ": Test notification");
}
