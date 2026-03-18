#include "notification_manager.h"
#include "neato_serial.h"
#include "settings_manager.h"
#include "data_logger.h"
#include <WiFi.h>
#include <WiFiClient.h>

#define NTFY_HOST "ntfy.sh"
#define NTFY_PORT 80
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
                    bool isIdle = ui == "UIMGR_STATE_IDLE" || ui == "UIMGR_STATE_STANDBY";

                    // Track cleaning context when entering docking
                    if (wasCleaning && isDocking) {
                        wasCleaningBeforeDock = true;
                    }

                    // Mid-clean recharge: robot state ST_M1_Charging_Cleaning means
                    // the robot docked to recharge and will resume cleaning afterwards
                    bool isRecharging = rs.indexOf("Charging_Cleaning") >= 0;

                    if (isDocking && !wasDocking && isRecharging && cfg.ntfyOnDocking) {
                        // Recharge dock — robot will resume cleaning after charging
                        sendNotification(topic, "electric_plug", hostname + ": Returning to base to recharge");
                    }

                    // Cleaning completed: cleaning/docking -> idle, but NOT if it's a recharge
                    bool dockingDone = wasDocking && wasCleaningBeforeDock && !isRecharging;
                    if ((wasCleaning || dockingDone) && isIdle && cfg.ntfyOnDone) {
                        sendNotification(topic, "white_check_mark", hostname + ": Cleaning done");
                    }

                    // Clear tracking flag when leaving docking
                    if (wasDocking && !isDocking) {
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
                // New error detected: was no error -> now has error
                if (err.hasError && (!prevHasError || err.errorCode != prevErrorCode) && cfg.ntfyOnError) {
                    String tag = err.kind == "warning" ? "information_source" : "warning";
                    sendNotification(topic, tag, hostname + ": " + err.displayMessage);
                }
                prevHasError = err.hasError;
                prevErrorCode = err.errorCode;
            }
        });
    });
}

bool NotificationManager::isActiveState(const String& uiState) {
    return uiState.indexOf("CLEANINGRUNNING") >= 0 || uiState.indexOf("CLEANINGPAUSED") >= 0 ||
           uiState.indexOf("DOCKING") >= 0;
}

void NotificationManager::sendNotification(const String& topic, const String& tags, const String& message) {
    LOG("NOTIF", "Sending: [%s] %s", tags.c_str(), message.c_str());

    WiFiClient client;
    client.setTimeout(NTFY_CONNECT_TIMEOUT_MS);

    if (!client.connect(NTFY_HOST, NTFY_PORT)) {
        LOG("NOTIF", "Connect to %s:%d failed", NTFY_HOST, NTFY_PORT);
        dataLogger.logNotification("notif_send_fail", message, false);
        return;
    }

    // Build minimal HTTP/1.1 POST request
    client.print("POST /" + topic + " HTTP/1.1\r\n");
    client.print("Host: " NTFY_HOST "\r\n");
    client.print("Content-Type: text/plain\r\n");
    client.print("Tags: " + tags + "\r\n");
    client.print("Content-Length: " + String(message.length()) + "\r\n");
    client.print("Connection: close\r\n");
    client.print("\r\n");
    client.print(message);

    // Read just the HTTP status line (e.g. "HTTP/1.1 200 OK\r\n")
    bool ok = false;
    String statusLine = client.readStringUntil('\n');
    if (statusLine.length() > 0) {
        int spaceIdx = statusLine.indexOf(' ');
        if (spaceIdx > 0) {
            int code = statusLine.substring(spaceIdx + 1, spaceIdx + 4).toInt();
            ok = (code >= 200 && code < 300);
            LOG("NOTIF", "Response: %d %s", code, ok ? "OK" : "FAIL");
        }
    }

    client.stop();

    dataLogger.logNotification("notif_sent", message, ok);
}

void NotificationManager::sendTestNotification(const String& topic) {
    const String& hostname = settings.get().hostname;
    sendNotification(topic, "bell", hostname + ": Test notification");
}
