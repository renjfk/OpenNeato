const textEncoder = new TextEncoder();

const defaultRand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const jsonResponse = (data, status = 200) => ({
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
});

const textResponse = (body, status = 200, headers = {}) => ({ status, headers, body });
const okResponse = () => jsonResponse({ ok: true });
const errorResponse = (message, status = 500) => jsonResponse({ error: message }, status);

const byteLength = (value) => textEncoder.encode(value).length;
const vBattFromFuel = (fuel) => Number((12.0 + (fuel / 100) * 4.6).toFixed(2));
const isSafeFilename = (name) => /^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..");

const mockLogs = [
    { name: "current.jsonl", size: 8192, compressed: false },
    { name: "1700000000.jsonl.hs", size: 4096, compressed: true },
    { name: "boot_2501.jsonl.hs", size: 1851, compressed: true },
];

const mockLogContent = [
    '{"t":1700000100,"typ":"boot","d":{"reason":"power_on","heap":195000}}',
    '{"t":1700000101,"typ":"wifi","d":{"event":"connected","rssi":-52}}',
    '{"t":1700000102,"typ":"ntp","d":{"event":"sync_ok","epoch":1700000102}}',
    '{"t":1700000200,"typ":"command","d":{"cmd":"GetCharger","status":"ok","ms":85,"q":0,"bytes":312,"resp":"GetCharger\\r\\nLabel,Value\\r\\nFuelPercent,85\\r\\nBatteryOverTemp,0\\r\\nChargingActive,0\\r\\nChargingEnabled,1\\r\\n"}}',
    '{"t":1700000202,"typ":"command","d":{"cmd":"GetState","status":"ok","ms":42,"q":0,"bytes":95,"resp":"GetState\\r\\nCurrent UI State is: UIMGR_STATE_IDLE\\nCurrent Robot State is: ST_C_Idle\\n"}}',
    '{"t":1700000203,"typ":"command","d":{"cmd":"GetState","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000210,"typ":"request","d":{"method":"GET","path":"/api/charger","status":200,"ms":92}}',
    '{"t":1700000215,"typ":"command","d":{"cmd":"GetErr","status":"ok","ms":38,"q":0,"bytes":64,"resp":"GetErr\\r\\nError\\r\\n200 -  (UI_ALERT_INVALID)\\r\\nAlert\\r\\n200 -  (UI_ALERT_INVALID)\\r\\n"}}',
    '{"t":1700000216,"typ":"command","d":{"cmd":"GetErr","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000220,"typ":"request","d":{"method":"GET","path":"/api/state","status":200,"ms":48}}',
    '{"t":1700000300,"typ":"command","d":{"cmd":"GetAnalogSensors","status":"ok","ms":120,"q":1,"bytes":480}}',
    '{"t":1700000305,"typ":"request","d":{"method":"POST","path":"/api/clean?action=house","status":200,"ms":210}}',
    '{"t":1700000306,"typ":"command","d":{"cmd":"Clean House","status":"ok","ms":95,"q":0,"bytes":28}}',
    '{"t":1700000400,"typ":"event","d":{"msg":"cleaning_started","mode":"house"}}',
    '{"t":1700000500,"typ":"command","d":{"cmd":"GetMotors","status":"ok","ms":110,"q":2,"bytes":520}}',
    '{"t":1700000600,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":450,"q":0,"bytes":8200}}',
    '{"t":1700000601,"typ":"command","d":{"cmd":"GetCharger","status":"ok","ms":0,"q":0,"bytes":0,"age":401}}',
    '{"t":1700000615,"typ":"request","d":{"method":"GET","path":"/api/lidar","status":200,"ms":460}}',
    '{"t":1700000620,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":440,"q":1,"bytes":8140}}',
    '{"t":1700000621,"typ":"command","d":{"cmd":"GetLDSScan","status":"ok","ms":0,"q":0,"bytes":0,"age":1}}',
    '{"t":1700000700,"typ":"event","d":{"msg":"cleaning_completed","duration":600}}',
].join("\n");

const syntheticLidarScan = (rand) => {
    const points = [];
    for (let i = 0; i < 360; i++) {
        const rad = (i * Math.PI) / 180;
        const base = 1500 + Math.round(Math.sin(rad * 2) * 250) + rand(-40, 40);
        points.push({ angle: i, dist: Math.max(0, base), intensity: rand(20, 70), error: 0 });
    }
    return { rotationSpeed: 5, validPoints: points.length, points };
};

const deriveStates = (state) => {
    if (state.manualClean) {
        state.uiState = "UIMGR_STATE_MANUALCLEANING";
        state.robotState = "ST_C_ManualCleaning";
    } else if (state.midCleanRecharge) {
        state.uiState = "UIMGR_STATE_CLEANINGSUSPENDED";
        state.robotState = "ST_M1_Charging_Cleaning";
    } else if (state.docking) {
        state.uiState = "UIMGR_STATE_DOCKINGRUNNING";
        state.robotState = "ST_C_Docking";
    } else if (state.cleaning && !state.paused) {
        state.uiState = "UIMGR_STATE_HOUSECLEANINGRUNNING";
        state.robotState = "ST_C_HouseCleaning";
    } else if (state.cleaning && state.paused) {
        state.uiState = "UIMGR_STATE_HOUSECLEANINGPAUSED";
        state.robotState = "ST_C_Standby";
    } else if (state.spotCleaning && !state.paused) {
        state.uiState = "UIMGR_STATE_SPOTCLEANINGRUNNING";
        state.robotState = "ST_C_SpotCleaning";
    } else if (state.spotCleaning && state.paused) {
        state.uiState = "UIMGR_STATE_SPOTCLEANINGPAUSED";
        state.robotState = "ST_C_Standby";
    } else {
        state.uiState = "UIMGR_STATE_IDLE";
        state.robotState = "ST_C_Idle";
    }
};

const settingsPayload = (state, includeNavMode = true) => {
    const settings = {};
    const keys = [
        "tz",
        "logLevel",
        "apFallbackOnDisconnect",
        "syslogEnabled",
        "syslogIp",
        "wifiTxPower",
        "uartTxPin",
        "uartRxPin",
        "maxGpioPin",
        "hostname",
        ...(includeNavMode ? ["navMode"] : []),
        "stallThreshold",
        "brushRpm",
        "vacuumSpeed",
        "sideBrushPower",
        "ntfyTopic",
        "ntfyEnabled",
        "ntfyOnDone",
        "ntfyOnError",
        "ntfyOnAlert",
        "ntfyOnDocking",
        "scheduleEnabled",
        "autoRestartEnabled",
        "autoRestartHour",
        "autoRestartMinute",
        "restartBeforeClean",
    ];
    for (const key of keys) settings[key] = state[key];
    for (let day = 0; day < 7; day++) {
        settings[`sched${day}Hour`] = state[`sched${day}Hour`];
        settings[`sched${day}Min`] = state[`sched${day}Min`];
        settings[`sched${day}On`] = state[`sched${day}On`];
        settings[`sched${day}Slot1Hour`] = state[`sched${day}Slot1Hour`];
        settings[`sched${day}Slot1Min`] = state[`sched${day}Slot1Min`];
        settings[`sched${day}Slot1On`] = state[`sched${day}Slot1On`];
    }
    return settings;
};

const injectCorruptedPoses = (lines) => {
    const corruptions = [
        '{"x":-0.798,"y":3.459,"t":100:5,"ts":8203.4}',
        '{"x":-0.785,"y":4.192,"t":100:3,"ts":8208.1}',
        '{"x":-1.286,"y":4.007,"t":177:5,"ts":8215.6}',
        '{"x":-1.8"3,"y":2.254,"t":181.0,"ts":8288.6}',
        '{"x":-1.946,"y":2.0"3,"t":181.9,"ts":8312.8}',
        '{"x":-4.793,"y":-1.6t2,"t":356.5,"ts":9182.5}',
        '{"x":-1.740,"y":3.510,"t":1.6,"ts":8242:0}',
    ];
    const result = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
        result.push(lines[i]);
        if (!lines[i].includes('"type"') && i % 20 === 0) result.push(corruptions[i % corruptions.length]);
    }
    return result;
};

const listHistory = (historySessions, faults) => {
    const list = [...historySessions.entries()].map(([name, lines]) => {
        let session = null;
        let summary = null;
        if (lines.length > 0) {
            try {
                const first = JSON.parse(lines[0]);
                if (first.type === "session") session = first;
            } catch {}
        }
        if (lines.length > 1) {
            try {
                const last = JSON.parse(lines[lines.length - 1]);
                if (last.type === "summary") summary = last;
            } catch {}
        }
        const raw = `${lines.join("\n")}\n`;
        return {
            name,
            size: byteLength(raw),
            compressed: name.endsWith(".hs"),
            recording: summary === null,
            session,
            summary,
        };
    });

    if (faults.historyListCorrupt && list.length > 0) {
        const target = list[Math.min(1, list.length - 1)];
        const summaryJson = target.summary ? JSON.stringify(target.summary) : '{"type":"summary"}';
        const corruptedSummary = `{"x":-0.218,"y":0.007,"t":35${summaryJson.slice(1)}`;
        return textResponse(
            JSON.stringify(list).replace(JSON.stringify(target.summary ?? null), corruptedSummary),
            200,
            {
                "Content-Type": "application/json",
            },
        );
    }

    return jsonResponse(list);
};

const parseMultipartJsonlUpload = (bodyBytes) => {
    const bodyStr = new TextDecoder("latin1").decode(bodyBytes);
    const nameMatch = bodyStr.match(/filename="([^"]+)"/);
    if (!nameMatch?.[1].endsWith(".jsonl") || !isSafeFilename(nameMatch[1])) {
        return { error: "Invalid file: expected a .jsonl session file", status: 400 };
    }
    const headerEnd = bodyStr.indexOf("\r\n\r\n");
    const boundaryEnd = bodyStr.lastIndexOf("\r\n--");
    if (headerEnd < 0 || boundaryEnd < 0) return { error: "Malformed multipart body", status: 400 };

    const filename = nameMatch[1];
    const content = new TextDecoder().decode(bodyBytes.slice(headerEnd + 4, boundaryEnd));
    const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
    if (lines.length === 0) return { error: "Empty session file", status: 400 };

    try {
        const header = JSON.parse(lines[0]);
        if (header.type !== "session") return { error: "First line must be a session header", status: 400 };
        const fileEpoch = filename.replace(".jsonl", "");
        if (header.time !== undefined && String(header.time) !== fileEpoch) {
            return { error: "Session timestamp does not match filename", status: 400 };
        }
    } catch {
        return { error: "Invalid JSON in session header", status: 400 };
    }

    return { filename, lines };
};

const extractFirmwarePayload = (bodyBytes) => {
    const bodyStr = new TextDecoder("latin1").decode(bodyBytes);
    const headerEnd = bodyStr.indexOf("\r\n\r\n");
    const boundaryEnd = bodyStr.lastIndexOf("\r\n--");
    const fileStart = headerEnd !== -1 ? headerEnd + 4 : -1;
    const fileEnd = boundaryEnd > fileStart ? boundaryEnd : bodyBytes.length;
    if (fileStart === -1) return null;
    return bodyBytes.slice(fileStart, fileEnd);
};

function createMockApi(context) {
    const rand = context.rand ?? defaultRand;
    const sleep = context.sleep ?? defaultSleep;

    const getState = () => context.state;
    const getFaults = () => context.faults;

    const handle = async (request) => {
        const state = getState();
        const faults = getFaults();
        const method = request.method;
        const path = request.path;
        const query = request.query;

        if (state.offline) return { offline: true };

        if (method === "GET" && path === "/api/version") {
            return jsonResponse({
                modelName: "BotVacD7",
                serialNumber: "OPS01234AA,0000001,D",
                softwareVersion: "4.5.3-142",
                ldsVersion: "V2.6.15295",
                ldsSerial: "KSH-V5F4",
                mainBoardVersion: "15.0",
                smartBatteryAuthorization: 1,
                smartBatteryDataVersion: 512,
                smartBatteryChemistry: "LION1",
                smartBatteryDeviceName: "F164A10288",
                smartBatteryManufacturerName: "Panasonic",
                smartBatteryMfgDate: "2089-02-18",
                smartBatterySerialNumber: "34832",
                smartBatterySoftwareVersion: "2048",
            });
        }

        if (method === "GET" && path === "/api/charger") {
            if (faults.pollCharger) return errorResponse("UART timeout reading charger", 500);
            const fuel = Math.round(state.fuelPercent);
            return jsonResponse({
                fuelPercent: fuel,
                batteryOverTemp: false,
                chargingActive: state.chargingActive,
                chargingEnabled: true,
                confidOnFuel: fuel > 20,
                onReservedFuel: fuel < 10,
                emptyFuel: fuel === 0,
                batteryFailure: false,
                extPwrPresent: state.extPwrPresent,
                vBattV: vBattFromFuel(fuel),
                vExtV: state.extPwrPresent ? 22.3 : 0.0,
                chargerMAH: state.chargingActive ? 1200 : 0,
                dischargeMAH: Math.round(((100 - fuel) / 100) * 2800),
            });
        }

        if (method === "GET" && path === "/api/analog") {
            if (faults.pollCharger) return errorResponse("UART timeout reading battery diagnostics", 500);
            const fuel = Math.round(state.fuelPercent);
            const batteryCurrentMA = state.chargingActive
                ? rand(180, 720)
                : state.extPwrPresent
                  ? rand(-20, 20)
                  : -rand(80, 420);
            return jsonResponse({
                batteryVoltageV: vBattFromFuel(fuel),
                batteryCurrentMA,
                batteryTemperatureC: Number((24 + (state.chargingActive ? 1.8 : 0) + Math.random()).toFixed(1)),
                externalVoltageV: state.extPwrPresent ? 18.66 : 0.0,
            });
        }

        if (method === "GET" && path === "/api/warranty") {
            return jsonResponse({
                cumulativeBatteryCycles: 728,
                cumulativeCleaningTimeSeconds: 885884,
                validationCode: "b40b2e9a",
            });
        }

        if (method === "POST" && path === "/api/battery/new") return okResponse();

        if (method === "GET" && path === "/api/motors") {
            const cleaning = state.cleaning || state.spotCleaning;
            return jsonResponse({
                brushRPM: cleaning ? rand(1100, 1300) : 0,
                brushMA: cleaning ? rand(200, 400) : 0,
                vacuumRPM: cleaning ? rand(2200, 2600) : 0,
                vacuumMA: cleaning ? rand(400, 700) : 0,
                leftWheelRPM: cleaning ? rand(60, 120) : 0,
                leftWheelLoad: cleaning ? rand(10, 40) : 0,
                leftWheelPositionMM: state.leftWheelPos,
                leftWheelSpeed: cleaning ? rand(150, 300) : 0,
                rightWheelRPM: cleaning ? rand(60, 120) : 0,
                rightWheelLoad: cleaning ? rand(10, 40) : 0,
                rightWheelPositionMM: state.rightWheelPos,
                rightWheelSpeed: cleaning ? rand(150, 300) : 0,
                sideBrushMA: cleaning ? rand(50, 200) : 0,
                laserRPM: cleaning ? rand(290, 310) : 0,
            });
        }

        if (method === "GET" && path === "/api/state") {
            if (faults.pollState) return errorResponse("UART timeout reading state", 500);
            deriveStates(state);
            return jsonResponse({ uiState: state.uiState, robotState: state.robotState });
        }

        if (method === "GET" && path === "/api/error") {
            if (faults.pollError) return errorResponse("UART timeout reading error", 500);
            return jsonResponse({
                hasError: state.hasError,
                kind: state.kind,
                errorCode: state.errorCode,
                errorMessage: state.errorMessage,
                displayMessage: state.displayMessage,
            });
        }

        if (method === "GET" && path === "/api/lidar") {
            if (state.lidarUnavailable) return errorResponse("UART timeout reading LDS scan", 500);
            const scan = context.getLidarScan ? context.getLidarScan() : syntheticLidarScan(rand);
            if (state.lidarLowQuality || state.lidarSlowRotation) {
                const degraded = { ...scan };
                if (state.lidarSlowRotation) degraded.rotationSpeed = 2.8;
                if (state.lidarLowQuality) {
                    degraded.points = scan.points.map((point, index) =>
                        index % 5 === 0 ? point : { ...point, dist: 0, intensity: 0, error: 8035 },
                    );
                    degraded.validPoints = degraded.points.filter((point) => point.dist > 0).length;
                }
                return jsonResponse(degraded);
            }
            return jsonResponse(scan);
        }

        if (method === "POST" && path === "/api/clean") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            const action = query.action || "house";
            if (action === "dock") {
                if (state.cleaning || state.spotCleaning) {
                    state.docking = true;
                    state.cleaning = false;
                    state.spotCleaning = false;
                    state.paused = false;
                }
            } else if (action === "pause") {
                if ((state.cleaning || state.spotCleaning) && !state.paused) state.paused = true;
            } else if (action === "stop") {
                state.cleaning = false;
                state.spotCleaning = false;
                state.docking = false;
                state.paused = false;
            } else if (action === "spot") {
                state.spotCleaning = true;
                state.cleaning = false;
                state.docking = false;
                state.paused = false;
            } else {
                state.cleaning = true;
                state.spotCleaning = false;
                state.docking = false;
                state.paused = false;
            }
            deriveStates(state);
            return okResponse();
        }

        if (method === "GET" && path === "/api/manual/status") {
            return jsonResponse({
                active: state.manualClean,
                brush: state.manualBrush,
                vacuum: state.manualVacuum,
                sideBrush: state.manualSideBrush,
                lifted: state.manualLifted,
                bumperFrontLeft: state.manualBumperFrontLeft,
                bumperFrontRight: state.manualBumperFrontRight,
                bumperSideLeft: state.manualBumperSideLeft,
                bumperSideRight: state.manualBumperSideRight,
                stallFront: state.manualStallFront,
                stallRear: state.manualStallRear,
            });
        }

        if (method === "POST" && path === "/api/manual/move") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            if (!state.manualClean) return errorResponse("Not in manual mode", 400);
            return okResponse();
        }

        if (method === "POST" && path === "/api/manual/motors") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            if (!state.manualClean) return errorResponse("Not in manual mode", 400);
            state.manualBrush = query.brush === "1";
            state.manualVacuum = query.vacuum === "1";
            state.manualSideBrush = query.sideBrush === "1";
            await sleep(600);
            return okResponse();
        }

        if (method === "POST" && path === "/api/power") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            if (query.action === "restart") return okResponse();
            if (query.action === "shutdown") {
                context.shutdown?.();
                return okResponse();
            }
            return errorResponse("unknown action", 400);
        }

        if (method === "POST" && path === "/api/clear-errors") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            return okResponse();
        }

        if (method === "POST" && path === "/api/sound") return okResponse();

        if (method === "POST" && path === "/api/manual") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            const enable = query.enable === "1";
            state.manualClean = enable;
            if (enable) {
                state.cleaning = false;
                state.spotCleaning = false;
                state.paused = false;
            }
            state.manualBrush = false;
            state.manualVacuum = false;
            state.manualSideBrush = false;
            if (!enable) {
                state.manualLifted = false;
                state.manualBumperFrontLeft = false;
                state.manualBumperFrontRight = false;
                state.manualBumperSideLeft = false;
                state.manualBumperSideRight = false;
                state.manualStallFront = false;
                state.manualStallRear = false;
            }
            deriveStates(state);
            return okResponse();
        }

        if (method === "POST" && path === "/api/lidar/rotate") {
            if (faults.actions) return errorResponse("UART timeout: robot not responding", 500);
            return okResponse();
        }

        if (method === "GET" && path === "/api/logs") {
            if (faults.logsRead) return errorResponse("SPIFFS read failed", 500);
            return jsonResponse(mockLogs);
        }

        if (method === "DELETE" && path === "/api/logs") {
            if (faults.logsDelete) return errorResponse("SPIFFS busy, try again later", 503);
            return okResponse();
        }

        const logFileMatch = path.match(/^\/api\/logs\/(.+)$/);
        if (logFileMatch) {
            const filename = decodeURIComponent(logFileMatch[1]);
            if (!isSafeFilename(filename)) return errorResponse("invalid filename", 400);
            if (method === "GET") {
                if (faults.logsRead) return errorResponse("SPIFFS read failed", 500);
                return textResponse(mockLogContent, 200, {
                    "Content-Type": "application/x-ndjson",
                    "Content-Disposition": `attachment; filename="${filename.replace(/\.hs$/, "")}"`,
                });
            }
            if (method === "DELETE") {
                if (faults.logsDelete) return errorResponse("SPIFFS busy, try again later", 503);
                return okResponse();
            }
            return errorResponse("method not allowed", 405);
        }

        if (method === "GET" && path === "/api/system") {
            const now = new Date();
            const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const pad = (number) => number.toString().padStart(2, "0");
            const localTime = `${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            return jsonResponse({
                heap: rand(160000, 200000),
                heapTotal: 327680,
                uptime: Date.now() - context.getBootTime(),
                rssi: rand(-65, -40),
                fsUsed: rand(10000, 50000),
                fsTotal: 262144,
                ntpSynced: true,
                time: Math.floor(Date.now() / 1000),
                timeSource: "ntp",
                tz: state.tz,
                localTime,
                isDst: now.getTimezoneOffset() !== new Date(now.getFullYear(), 0, 1).getTimezoneOffset(),
            });
        }

        if (method === "POST" && ["/api/system/restart", "/api/system/format-fs", "/api/system/reset"].includes(path)) {
            context.reboot?.();
            return okResponse();
        }

        if (method === "GET" && path === "/api/settings") return jsonResponse(settingsPayload(state));

        if (method === "PUT" && path === "/api/settings") {
            if (faults.settings) {
                await sleep(rand(200, 400));
                return errorResponse("NVS write failed: flash error", 500);
            }
            try {
                const data = JSON.parse(await request.text());
                await sleep(rand(300, 600));
                const oldTx = state.uartTxPin;
                const oldRx = state.uartRxPin;
                const oldHostname = state.hostname;
                Object.assign(state, data);
                if (state.uartTxPin !== oldTx || state.uartRxPin !== oldRx || state.hostname !== oldHostname)
                    context.reboot?.();
                return jsonResponse(settingsPayload(state, false));
            } catch {
                return errorResponse("invalid JSON", 400);
            }
        }

        if (method === "GET" && path === "/api/wifi/status") {
            const hasCreds = !state.wifiNoCredentials;
            const apOn = !!state.wifiDisconnected || !hasCreds;
            return jsonResponse({
                staConnected: !state.wifiDisconnected && hasCreds,
                ssid: hasCreds ? "HomeWiFi" : "",
                ip: state.wifiDisconnected || !hasCreds ? "" : "192.168.1.42",
                rssi: state.wifiDisconnected || !hasCreds ? 0 : -52,
                apActive: apOn,
                apSsid: apOn ? `${state.hostname}-ap` : "",
                apIp: apOn ? "192.168.4.1" : "",
                apClients: apOn ? (hasCreds ? 1 : 0) : 0,
                apFallbackOnDisconnect: state.apFallbackOnDisconnect,
                lastError: state.wifiDisconnected && hasCreds ? "wrong password or authentication rejected" : "",
            });
        }

        if (method === "GET" && path === "/api/wifi/scan") {
            await sleep(rand(800, 1500));
            if (faults.wifiScan) return errorResponse("WiFi scan failed: radio busy", 500);
            if (faults.wifiScanEmpty) return jsonResponse({ networks: [] });
            return jsonResponse({
                networks: [
                    { ssid: "HomeWiFi", rssi: -52, open: false },
                    { ssid: "Neighbour-5G", rssi: -68, open: false },
                    { ssid: "GuestNet", rssi: -71, open: true },
                    { ssid: "FritzBox-2", rssi: -78, open: false },
                    { ssid: "TP-Link-Guest", rssi: -82, open: true },
                ],
            });
        }

        if (method === "POST" && path === "/api/wifi/connect") {
            if (!query.ssid) return errorResponse("missing ssid", 400);
            await sleep(rand(500, 1500));
            if (faults.wifiConnect) return errorResponse("wrong password or authentication rejected", 500);
            state.wifiDisconnected = false;
            state.wifiNoCredentials = false;
            return okResponse();
        }

        if (method === "POST" && path === "/api/wifi/disconnect") {
            state.wifiDisconnected = true;
            state.wifiNoCredentials = true;
            return okResponse();
        }

        if (method === "POST" && path === "/api/notifications/test") {
            if (!query.topic) return errorResponse("missing topic", 400);
            return okResponse();
        }

        if (method === "GET" && path === "/repos/renjfk/OpenNeato/releases/latest")
            return jsonResponse({ tag_name: "v1.0" });

        if (method === "GET" && path === "/api/user-settings") {
            return jsonResponse({
                buttonClick: state.buttonClick,
                melodies: state.melodies,
                warnings: state.warnings,
                ecoMode: state.ecoMode,
                intenseClean: state.intenseClean,
                binFullDetect: state.binFullDetect,
                wallEnable: state.wallEnable,
                wifi: state.wifi,
                stealthLed: state.stealthLed,
                filterChange: state.filterChange,
                brushChange: state.brushChange,
                dirtBin: state.dirtBin,
            });
        }

        if (method === "POST" && path === "/api/user-settings") {
            const keyMap = {
                ButtonClick: "buttonClick",
                Melodies: "melodies",
                Warnings: "warnings",
                EcoMode: "ecoMode",
                IntenseClean: "intenseClean",
                BinFullDetect: "binFullDetect",
                WallEnable: "wallEnable",
                WiFi: "wifi",
                StealthLED: "stealthLed",
                FilterChange: "filterChange",
                BrushChange: "brushChange",
                DirtBin: "dirtBin",
            };
            const serialKey = query.key;
            const value = query.value;
            if (!serialKey || !value) return errorResponse("missing key or value", 400);
            const stateKey = keyMap[serialKey];
            if (!stateKey) return errorResponse("unknown key", 400);
            state[stateKey] = ["filterChange", "brushChange", "dirtBin"].includes(stateKey)
                ? Number.parseInt(value, 10)
                : value.toUpperCase() === "ON";
            return okResponse();
        }

        if (method === "GET" && path === "/api/firmware/version") {
            const version = state.firmwareVersion ?? (await context.getVersion());
            return jsonResponse({
                name: "OpenNeato",
                version,
                chip: "ESP32-C3",
                model: state.identifying ? "" : state.unsupported ? "Botvac Connected" : "Botvac D7",
                hostname: "neato-kitchen",
                supported: !state.unsupported && !state.identifying,
                identifying: state.identifying,
                repositoryUrl: "https://github.com/renjfk/OpenNeato",
                license: "MIT",
            });
        }

        if (method === "POST" && path === "/api/firmware/update") {
            const expectedMd5 = query.hash || "";
            if (!expectedMd5) return errorResponse("MD5 hash required", 400);
            const bodyBytes = await request.bytes();
            const fileBytes = extractFirmwarePayload(bodyBytes);
            if (fileBytes) {
                const mockChipId = 5;
                if (fileBytes.length >= 16 && fileBytes[12] !== mockChipId) {
                    return errorResponse("Firmware chip mismatch: file targets a different ESP32 variant", 400);
                }
                if (!context.md5Hex) return errorResponse("MD5 verification unavailable", 500);
                const actualMd5 = await context.md5Hex(fileBytes);
                if (actualMd5 !== expectedMd5.toLowerCase())
                    return errorResponse("MD5 mismatch: firmware integrity check failed", 400);
            }
            await sleep(rand(3000, 5000));
            context.reboot?.();
            return okResponse();
        }

        if (method === "POST" && path === "/api/serial") {
            const cmd = query.cmd;
            if (!cmd) return errorResponse("missing cmd", 400);
            await sleep(rand(50, 150));
            return textResponse(`${cmd}\r\nMock response for: ${cmd}\r\n\x1a`, 200, { "Content-Type": "text/plain" });
        }

        if (method === "GET" && path === "/api/history") return listHistory(context.historySessions, faults);

        if (method === "DELETE" && path === "/api/history") {
            context.historySessions.clear();
            return okResponse();
        }

        if (method === "POST" && path === "/api/history/import") {
            const parsed = parseMultipartJsonlUpload(await request.bytes());
            if (parsed.error) return errorResponse(parsed.error, parsed.status);
            const storedName = `${parsed.filename}.hs`;
            if (context.historySessions.has(storedName) || context.historySessions.has(parsed.filename)) {
                return errorResponse("Session already exists", 409);
            }
            context.historySessions.set(storedName, parsed.lines);
            await sleep(rand(200, 500));
            return okResponse();
        }

        const historyMatch = path.match(/^\/api\/history\/(.+)$/);
        if (historyMatch) {
            const filename = decodeURIComponent(historyMatch[1]);
            if (method === "GET") {
                const lines = context.historySessions.get(filename);
                if (!lines) return errorResponse("session not found", 404);
                const served = faults.historyCorrupt ? injectCorruptedPoses(lines) : lines;
                return textResponse(`${served.join("\n")}\n`, 200, { "Content-Type": "application/x-ndjson" });
            }
            if (method === "DELETE") {
                context.historySessions.delete(filename);
                return okResponse();
            }
            return errorResponse("method not allowed", 405);
        }

        return false;
    };

    return { handle };
}

export { createMockApi };
