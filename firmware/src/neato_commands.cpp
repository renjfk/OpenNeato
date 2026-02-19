#include "neato_commands.h"
#include "config.h"

// -- CSV parsing helpers -----------------------------------------------------

// Find value for a given label in "Label,Value\r\n" formatted response.
// Searches line by line, matching label prefix (case-sensitive).
static bool findCsvValue(const String& raw, const String& label, String& value) {
    int pos = 0;
    while (pos < static_cast<int>(raw.length())) {
        int lineEnd = raw.indexOf('\n', pos);
        if (lineEnd < 0)
            lineEnd = raw.length();

        String line = raw.substring(pos, lineEnd);
        line.trim();

        int comma = line.indexOf(',');
        if (comma > 0) {
            String key = line.substring(0, comma);
            key.trim();
            if (key == label) {
                value = line.substring(comma + 1);
                value.trim();
                // Strip trailing comma if present (GetAnalogSensors format)
                if (value.endsWith(",")) {
                    value = value.substring(0, value.length() - 1);
                }
                return true;
            }
        }
        pos = lineEnd + 1;
    }
    return false;
}

// Find value in 3-column CSV "Name,Unit,Value," format (GetAnalogSensors)
static bool findCsv3Value(const String& raw, const String& label, String& value) {
    int pos = 0;
    while (pos < static_cast<int>(raw.length())) {
        int lineEnd = raw.indexOf('\n', pos);
        if (lineEnd < 0)
            lineEnd = raw.length();

        String line = raw.substring(pos, lineEnd);
        line.trim();

        // Find first and second commas
        int comma1 = line.indexOf(',');
        if (comma1 > 0) {
            String key = line.substring(0, comma1);
            key.trim();
            if (key == label) {
                int comma2 = line.indexOf(',', comma1 + 1);
                if (comma2 > 0) {
                    value = line.substring(comma2 + 1);
                    value.trim();
                    if (value.endsWith(",")) {
                        value = value.substring(0, value.length() - 1);
                    }
                    return true;
                }
            }
        }
        pos = lineEnd + 1;
    }
    return false;
}

// -- toFields() implementations ----------------------------------------------

std::vector<Field> VersionData::toFields() const {
    return {
            {"modelName", modelName, FIELD_STRING},
            {"serialNumber", serialNumber, FIELD_STRING},
            {"softwareVersion", softwareVersion, FIELD_STRING},
            {"ldsVersion", ldsVersion, FIELD_STRING},
            {"ldsSerial", ldsSerial, FIELD_STRING},
            {"mainBoardVersion", mainBoardVersion, FIELD_STRING},
    };
}

std::vector<Field> ChargerData::toFields() const {
    return {
            {"fuelPercent", String(fuelPercent), FIELD_INT},
            {"batteryOverTemp", batteryOverTemp ? "true" : "false", FIELD_BOOL},
            {"chargingActive", chargingActive ? "true" : "false", FIELD_BOOL},
            {"chargingEnabled", chargingEnabled ? "true" : "false", FIELD_BOOL},
            {"confidOnFuel", confidOnFuel ? "true" : "false", FIELD_BOOL},
            {"onReservedFuel", onReservedFuel ? "true" : "false", FIELD_BOOL},
            {"emptyFuel", emptyFuel ? "true" : "false", FIELD_BOOL},
            {"batteryFailure", batteryFailure ? "true" : "false", FIELD_BOOL},
            {"extPwrPresent", extPwrPresent ? "true" : "false", FIELD_BOOL},
            {"vBattV", String(vBattV, 2), FIELD_FLOAT},
            {"vExtV", String(vExtV, 2), FIELD_FLOAT},
            {"chargerMAH", String(chargerMAH), FIELD_INT},
            {"dischargeMAH", String(dischargeMAH), FIELD_INT},
    };
}

std::vector<Field> AnalogSensorData::toFields() const {
    return {
            {"batteryVoltage", String(batteryVoltage), FIELD_INT},
            {"batteryCurrent", String(batteryCurrent), FIELD_INT},
            {"batteryTemp", String(batteryTemp), FIELD_INT},
            {"externalVoltage", String(externalVoltage), FIELD_INT},
            {"accelX", String(accelX), FIELD_INT},
            {"accelY", String(accelY), FIELD_INT},
            {"accelZ", String(accelZ), FIELD_INT},
            {"vacuumCurrent", String(vacuumCurrent), FIELD_INT},
            {"sideBrushCurrent", String(sideBrushCurrent), FIELD_INT},
            {"magSensorLeft", String(magSensorLeft), FIELD_INT},
            {"magSensorRight", String(magSensorRight), FIELD_INT},
            {"wallSensor", String(wallSensor), FIELD_INT},
            {"dropSensorLeft", String(dropSensorLeft), FIELD_INT},
            {"dropSensorRight", String(dropSensorRight), FIELD_INT},
    };
}

std::vector<Field> DigitalSensorData::toFields() const {
    return {
            {"dcJackIn", dcJackIn ? "true" : "false", FIELD_BOOL},
            {"dustbinIn", dustbinIn ? "true" : "false", FIELD_BOOL},
            {"leftWheelExtended", leftWheelExtended ? "true" : "false", FIELD_BOOL},
            {"rightWheelExtended", rightWheelExtended ? "true" : "false", FIELD_BOOL},
            {"lSideBit", lSideBit ? "true" : "false", FIELD_BOOL},
            {"lFrontBit", lFrontBit ? "true" : "false", FIELD_BOOL},
            {"lLdsBit", lLdsBit ? "true" : "false", FIELD_BOOL},
            {"rSideBit", rSideBit ? "true" : "false", FIELD_BOOL},
            {"rFrontBit", rFrontBit ? "true" : "false", FIELD_BOOL},
            {"rLdsBit", rLdsBit ? "true" : "false", FIELD_BOOL},
    };
}

std::vector<Field> MotorData::toFields() const {
    return {
            {"brushRPM", String(brushRPM), FIELD_INT},
            {"brushMA", String(brushMA), FIELD_INT},
            {"vacuumRPM", String(vacuumRPM), FIELD_INT},
            {"vacuumMA", String(vacuumMA), FIELD_INT},
            {"leftWheelRPM", String(leftWheelRPM), FIELD_INT},
            {"leftWheelLoad", String(leftWheelLoad), FIELD_INT},
            {"leftWheelPositionMM", String(leftWheelPositionMM), FIELD_INT},
            {"leftWheelSpeed", String(leftWheelSpeed), FIELD_INT},
            {"rightWheelRPM", String(rightWheelRPM), FIELD_INT},
            {"rightWheelLoad", String(rightWheelLoad), FIELD_INT},
            {"rightWheelPositionMM", String(rightWheelPositionMM), FIELD_INT},
            {"rightWheelSpeed", String(rightWheelSpeed), FIELD_INT},
            {"sideBrushMA", String(sideBrushMA), FIELD_INT},
            {"laserRPM", String(laserRPM), FIELD_INT},
    };
}

std::vector<Field> RobotState::toFields() const {
    return {
            {"uiState", uiState, FIELD_STRING},
            {"robotState", robotState, FIELD_STRING},
    };
}

std::vector<Field> ErrorData::toFields() const {
    return {
            {"hasError", hasError ? "true" : "false", FIELD_BOOL},
            {"errorCode", String(errorCode), FIELD_INT},
            {"errorMessage", errorMessage, FIELD_STRING},
    };
}

std::vector<Field> AccelData::toFields() const {
    return {
            {"pitchDeg", String(pitchDeg, 2), FIELD_FLOAT}, {"rollDeg", String(rollDeg, 2), FIELD_FLOAT},
            {"xInG", String(xInG, 4), FIELD_FLOAT},         {"yInG", String(yInG, 4), FIELD_FLOAT},
            {"zInG", String(zInG, 4), FIELD_FLOAT},         {"sumInG", String(sumInG, 4), FIELD_FLOAT},
    };
}

std::vector<Field> ButtonData::toFields() const {
    return {
            {"softKey", softKey ? "true" : "false", FIELD_BOOL},
            {"scrollUp", scrollUp ? "true" : "false", FIELD_BOOL},
            {"start", start ? "true" : "false", FIELD_BOOL},
            {"back", back ? "true" : "false", FIELD_BOOL},
            {"scrollDown", scrollDown ? "true" : "false", FIELD_BOOL},
    };
}

std::vector<Field> TimeData::toFields() const {
    return {
            {"dayOfWeek", String(dayOfWeek), FIELD_INT},
            {"hour", String(hour), FIELD_INT},
            {"minute", String(minute), FIELD_INT},
            {"second", String(second), FIELD_INT},
    };
}

// -- LDS scan special serializers --------------------------------------------

String LdsScanData::toJson() const {
    String json = "{\"rotationSpeed\":" + String(rotationSpeed, 2) + ",\"validPoints\":" + String(validPoints) +
                  ",\"points\":[";
    for (int i = 0; i < 360; i++) {
        if (i > 0)
            json += ",";
        json += "{\"angle\":" + String(points[i].angleDeg) + ",\"dist\":" + String(points[i].distMM) +
                ",\"intensity\":" + String(points[i].intensity) + ",\"error\":" + String(points[i].errorCode) + "}";
    }
    json += "]}";
    return json;
}

// -- Response parsers --------------------------------------------------------

bool parseVersionData(const String& raw, VersionData& out) {
    String val;
    if (findCsvValue(raw, "Product Model", val) || findCsvValue(raw, "ModelID", val)) {
        // ModelID format: "0,XV11," — extract model name
        int comma = val.indexOf(',');
        if (comma > 0) {
            out.modelName = val.substring(comma + 1);
            out.modelName.trim();
            if (out.modelName.endsWith(",")) {
                out.modelName = out.modelName.substring(0, out.modelName.length() - 1);
            }
        } else {
            out.modelName = val;
        }
    }
    if (findCsvValue(raw, "Serial Number", val)) {
        out.serialNumber = val;
    }
    if (findCsvValue(raw, "Software", val)) {
        out.softwareVersion = val;
        // Replace commas with dots: "6,1,13328" -> "6.1.13328"
        out.softwareVersion.replace(",", ".");
    }
    if (findCsvValue(raw, "LDS Software", val)) {
        out.ldsVersion = val;
    }
    if (findCsvValue(raw, "LDS Serial", val)) {
        out.ldsSerial = val;
    }
    if (findCsvValue(raw, "MainBoard Version", val)) {
        out.mainBoardVersion = val;
        out.mainBoardVersion.replace(",", ".");
    }
    return out.modelName.length() > 0 || out.softwareVersion.length() > 0;
}

bool parseChargerData(const String& raw, ChargerData& out) {
    String val;
    if (findCsvValue(raw, "FuelPercent", val))
        out.fuelPercent = val.toInt();
    if (findCsvValue(raw, "BatteryOverTemp", val))
        out.batteryOverTemp = val.toInt() != 0;
    if (findCsvValue(raw, "ChargingActive", val))
        out.chargingActive = val.toInt() != 0;
    if (findCsvValue(raw, "ChargingEnabled", val))
        out.chargingEnabled = val.toInt() != 0;
    if (findCsvValue(raw, "ConfidentOnFuel", val))
        out.confidOnFuel = val.toInt() != 0;
    if (findCsvValue(raw, "OnReservedFuel", val))
        out.onReservedFuel = val.toInt() != 0;
    if (findCsvValue(raw, "EmptyFuel", val))
        out.emptyFuel = val.toInt() != 0;
    if (findCsvValue(raw, "BatteryFailure", val))
        out.batteryFailure = val.toInt() != 0;
    if (findCsvValue(raw, "ExtPwrPresent", val))
        out.extPwrPresent = val.toInt() != 0;
    if (findCsvValue(raw, "VBattV", val))
        out.vBattV = val.toFloat();
    if (findCsvValue(raw, "VExtV", val))
        out.vExtV = val.toFloat();
    if (findCsvValue(raw, "Charger_mAH", val))
        out.chargerMAH = val.toInt();
    if (findCsvValue(raw, "Discharge_mAH", val))
        out.dischargeMAH = val.toInt();
    return out.fuelPercent >= 0;
}

bool parseAnalogSensorData(const String& raw, AnalogSensorData& out) {
    String val;
    bool found = false;

    // Try 3-column format first: "SensorName,Unit,Value,"
    if (findCsv3Value(raw, "BatteryVoltage", val)) {
        out.batteryVoltage = val.toInt();
        found = true;
    }
    if (findCsv3Value(raw, "BatteryCurrent", val))
        out.batteryCurrent = val.toInt();
    if (findCsv3Value(raw, "BatteryTemperature", val))
        out.batteryTemp = val.toInt();
    if (findCsv3Value(raw, "ExternalVoltage", val))
        out.externalVoltage = val.toInt();
    if (findCsv3Value(raw, "AccelerometerX", val))
        out.accelX = val.toInt();
    if (findCsv3Value(raw, "AccelerometerY", val))
        out.accelY = val.toInt();
    if (findCsv3Value(raw, "AccelerometerZ", val))
        out.accelZ = val.toInt();
    if (findCsv3Value(raw, "VacuumCurrent", val))
        out.vacuumCurrent = val.toInt();
    if (findCsv3Value(raw, "SideBrushCurrent", val))
        out.sideBrushCurrent = val.toInt();
    if (findCsv3Value(raw, "MagSensorLeft", val))
        out.magSensorLeft = val.toInt();
    if (findCsv3Value(raw, "MagSensorRight", val))
        out.magSensorRight = val.toInt();
    if (findCsv3Value(raw, "WallSensor", val))
        out.wallSensor = val.toInt();
    if (findCsv3Value(raw, "DropSensorLeft", val))
        out.dropSensorLeft = val.toInt();
    if (findCsv3Value(raw, "DropSensorRight", val))
        out.dropSensorRight = val.toInt();

    // Fallback: try 2-column raw format "SensorName,Value"
    if (!found) {
        if (findCsvValue(raw, "BatteryVoltageInmV", val)) {
            out.batteryVoltage = val.toInt();
            found = true;
        }
        if (findCsvValue(raw, "CurrentInmA", val))
            out.batteryCurrent = val.toInt();
        if (findCsvValue(raw, "WallSensorInMM", val))
            out.wallSensor = val.toInt();
        if (findCsvValue(raw, "LeftDropInMM", val))
            out.dropSensorLeft = val.toInt();
        if (findCsvValue(raw, "RightDropInMM", val))
            out.dropSensorRight = val.toInt();
        if (findCsvValue(raw, "LeftMagSensor", val))
            out.magSensorLeft = val.toInt();
        if (findCsvValue(raw, "RightMagSensor", val))
            out.magSensorRight = val.toInt();
        if (findCsvValue(raw, "VacuumCurrentInmA", val))
            out.vacuumCurrent = val.toInt();
    }
    return found;
}

bool parseDigitalSensorData(const String& raw, DigitalSensorData& out) {
    String val;
    bool found = false;
    if (findCsvValue(raw, "SNSR_DC_JACK_IS_IN", val) || findCsvValue(raw, "SNSR_DC_JACK_CONNECT", val)) {
        out.dcJackIn = val.toInt() != 0;
        found = true;
    }
    if (findCsvValue(raw, "SNSR_DUSTBIN_IS_IN", val))
        out.dustbinIn = val.toInt() != 0;
    if (findCsvValue(raw, "SNSR_LEFT_WHEEL_EXTENDED", val))
        out.leftWheelExtended = val.toInt() != 0;
    if (findCsvValue(raw, "SNSR_RIGHT_WHEEL_EXTENDED", val))
        out.rightWheelExtended = val.toInt() != 0;
    if (findCsvValue(raw, "LSIDEBIT", val))
        out.lSideBit = val.toInt() != 0;
    if (findCsvValue(raw, "LFRONTBIT", val))
        out.lFrontBit = val.toInt() != 0;
    if (findCsvValue(raw, "LLDSBIT", val))
        out.lLdsBit = val.toInt() != 0;
    if (findCsvValue(raw, "RSIDEBIT", val))
        out.rSideBit = val.toInt() != 0;
    if (findCsvValue(raw, "RFRONTBIT", val))
        out.rFrontBit = val.toInt() != 0;
    if (findCsvValue(raw, "RLDSBIT", val))
        out.rLdsBit = val.toInt() != 0;
    return found;
}

bool parseMotorData(const String& raw, MotorData& out) {
    String val;
    bool found = false;
    if (findCsvValue(raw, "Brush_RPM", val)) {
        out.brushRPM = val.toInt();
        found = true;
    }
    if (findCsvValue(raw, "Brush_mA", val))
        out.brushMA = val.toInt();
    if (findCsvValue(raw, "Brush_MaxPWM", val))
        out.brushMaxPWM = val.toInt();
    if (findCsvValue(raw, "Vacuum_RPM", val))
        out.vacuumRPM = val.toInt();
    if (findCsvValue(raw, "Vacuum_CurrentInMA", val))
        out.vacuumMA = val.toInt();
    if (findCsvValue(raw, "LeftWheel_RPM", val))
        out.leftWheelRPM = val.toInt();
    if (findCsvValue(raw, "LeftWheel_Load%", val))
        out.leftWheelLoad = val.toInt();
    if (findCsvValue(raw, "LeftWheel_PositionInMM", val))
        out.leftWheelPositionMM = val.toInt();
    if (findCsvValue(raw, "LeftWheel_Speed", val))
        out.leftWheelSpeed = val.toInt();
    if (findCsvValue(raw, "RightWheel_RPM", val))
        out.rightWheelRPM = val.toInt();
    if (findCsvValue(raw, "RightWheel_Load%", val))
        out.rightWheelLoad = val.toInt();
    if (findCsvValue(raw, "RightWheel_PositionInMM", val))
        out.rightWheelPositionMM = val.toInt();
    if (findCsvValue(raw, "RightWheel_Speed", val))
        out.rightWheelSpeed = val.toInt();
    if (findCsvValue(raw, "SideBrush_mA", val))
        out.sideBrushMA = val.toInt();
    if (findCsvValue(raw, "Laser_RPM", val))
        out.laserRPM = val.toInt();
    return found;
}

bool parseRobotState(const String& raw, RobotState& out) {
    // Format: "Current UI State is: UIMGR_STATE_STANDBY\r\n"
    //         "Current Robot State is: ST_C_Standby\r\n"
    int uiPos = raw.indexOf("Current UI State is:");
    if (uiPos >= 0) {
        int start = uiPos + 20; // length of "Current UI State is:"
        int end = raw.indexOf('\n', start);
        if (end < 0)
            end = raw.length();
        out.uiState = raw.substring(start, end);
        out.uiState.trim();
    }
    int robotPos = raw.indexOf("Current Robot State is:");
    if (robotPos >= 0) {
        int start = robotPos + 23; // length of "Current Robot State is:"
        int end = raw.indexOf('\n', start);
        if (end < 0)
            end = raw.length();
        out.robotState = raw.substring(start, end);
        out.robotState.trim();
    }
    return out.uiState.length() > 0;
}

bool parseErrorData(const String& raw, ErrorData& out) {
    // Empty or whitespace-only response = no error
    String trimmed = raw;
    trimmed.trim();
    if (trimmed.length() == 0) {
        out.hasError = false;
        out.errorCode = 200;
        out.errorMessage = "";
        return true;
    }
    // Look for error/alert code lines (e.g. "200 -  (UI_ALERT_INVALID)")
    // The response may contain multiple lines; scan for the first numeric code.
    out.errorMessage = trimmed;
    out.hasError = true;

    // Search all lines for a code pattern "NNN - ..."
    int searchFrom = 0;
    while (searchFrom < static_cast<int>(trimmed.length())) {
        int dashPos = trimmed.indexOf(" - ", searchFrom);
        if (dashPos < 0)
            break;

        // Walk backwards from dash to find the start of the number
        int numStart = dashPos - 1;
        while (numStart >= 0 && trimmed[numStart] >= '0' && trimmed[numStart] <= '9')
            numStart--;
        numStart++; // Move back to first digit

        if (numStart < dashPos) {
            int code = trimmed.substring(numStart, dashPos).toInt();
            if (code > 0) {
                out.errorCode = code;
                // Code 200 = UI_ALERT_INVALID = no error
                if (code == 200) {
                    out.hasError = false;
                    out.errorMessage = "";
                } else {
                    out.errorMessage = trimmed.substring(dashPos + 3);
                    out.errorMessage.trim();
                }
                break;
            }
        }
        searchFrom = dashPos + 3;
    }
    return true;
}

bool parseAccelData(const String& raw, AccelData& out) {
    String val;
    bool found = false;
    if (findCsvValue(raw, "PitchInDegrees", val)) {
        out.pitchDeg = val.toFloat();
        found = true;
    }
    if (findCsvValue(raw, "RollInDegrees", val))
        out.rollDeg = val.toFloat();
    if (findCsvValue(raw, "XInG", val))
        out.xInG = val.toFloat();
    if (findCsvValue(raw, "YInG", val))
        out.yInG = val.toFloat();
    if (findCsvValue(raw, "ZInG", val))
        out.zInG = val.toFloat();
    if (findCsvValue(raw, "SumInG", val))
        out.sumInG = val.toFloat();
    return found;
}

bool parseButtonData(const String& raw, ButtonData& out) {
    String val;
    bool found = false;
    if (findCsvValue(raw, "BTN_SOFT_KEY", val)) {
        out.softKey = val.toInt() != 0;
        found = true;
    }
    if (findCsvValue(raw, "BTN_SCROLL_UP", val))
        out.scrollUp = val.toInt() != 0;
    if (findCsvValue(raw, "BTN_START", val))
        out.start = val.toInt() != 0;
    if (findCsvValue(raw, "BTN_BACK", val))
        out.back = val.toInt() != 0;
    if (findCsvValue(raw, "BTN_SCROLL_DOWN", val))
        out.scrollDown = val.toInt() != 0;
    return found;
}

bool parseLdsScanData(const String& raw, LdsScanData& out) {
    out.validPoints = 0;
    out.rotationSpeed = 0.0f;

    // Initialize all points
    for (int i = 0; i < 360; i++) {
        out.points[i].angleDeg = i;
        out.points[i].distMM = 0;
        out.points[i].intensity = 0;
        out.points[i].errorCode = 0;
    }

    int pos = 0;
    bool foundData = false;

    while (pos < static_cast<int>(raw.length())) {
        int lineEnd = raw.indexOf('\n', pos);
        if (lineEnd < 0)
            lineEnd = raw.length();

        String line = raw.substring(pos, lineEnd);
        line.trim();
        pos = lineEnd + 1;

        // Skip header line
        if (line.startsWith("AngleInDegrees") || line.startsWith("AngleDeg")) {
            continue;
        }

        // Check for ROTATION_SPEED line
        if (line.startsWith("ROTATION_SPEED")) {
            int comma = line.indexOf(',');
            if (comma > 0) {
                String val = line.substring(comma + 1);
                val.trim();
                out.rotationSpeed = val.toFloat();
            }
            continue;
        }

        // Skip empty lines
        if (line.length() == 0)
            continue;

        // Parse data line: "angle,dist,intensity,error"
        int c1 = line.indexOf(',');
        if (c1 < 0)
            continue;
        int c2 = line.indexOf(',', c1 + 1);
        if (c2 < 0)
            continue;
        int c3 = line.indexOf(',', c2 + 1);
        if (c3 < 0)
            continue;

        int angle = line.substring(0, c1).toInt();
        if (angle < 0 || angle >= 360)
            continue;

        out.points[angle].angleDeg = angle;
        out.points[angle].distMM = line.substring(c1 + 1, c2).toInt();
        out.points[angle].intensity = line.substring(c2 + 1, c3).toInt();
        out.points[angle].errorCode = line.substring(c3 + 1).toInt();

        if (out.points[angle].errorCode == 0 && out.points[angle].distMM > 0) {
            out.validPoints++;
        }
        foundData = true;
    }
    return foundData;
}

// -- Time parser -------------------------------------------------------------

bool parseTimeData(const String& raw, TimeData& out) {
    // Format: "Sunday 13:57:09" (DayOfWeek HH:MM:SS)
    String line = raw;
    line.trim();

    // Map day name to number
    static const char *days[] = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};
    int spaceIdx = line.indexOf(' ');
    if (spaceIdx < 0)
        return false;

    String dayName = line.substring(0, spaceIdx);
    out.dayOfWeek = -1;
    for (int i = 0; i < 7; i++) {
        if (dayName.equalsIgnoreCase(days[i])) {
            out.dayOfWeek = i;
            break;
        }
    }

    String timeStr = line.substring(spaceIdx + 1);
    int h = 0, m = 0, s = 0;
    if (sscanf(timeStr.c_str(), "%d:%d:%d", &h, &m, &s) != 3)
        return false;

    out.hour = h;
    out.minute = m;
    out.second = s;
    return true;
}
