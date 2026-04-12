#include "neato_commands.h"
#include "config.h"

// -- Human-readable error/alert messages -------------------------------------

struct ErrorMessage {
    const char *token;
    const char *message;
};

// Errors (UI_ERROR_*) - action required
static const ErrorMessage ERROR_MESSAGES[] = {
        {"UI_ERROR_CHECK_BATTERY_SWITCH", "Check the battery switch"},
        {"UI_ERROR_DISCONNECT_CHRG_CABLE", "Disconnect the charging cable"},
        {"UI_ERROR_DISCONNECT_USB_CABLE", "Disconnect the USB cable"},
        {"UI_ERROR_SCHED_OFF", "Schedule is disabled"},
        {"UI_ERROR_TIME_NOT_SET", "Clock is not set"},
        {"UI_ERROR_DUST_BIN_EMPTIED", "Dust bin removed during cleaning"},
        {"UI_ERROR_DUST_BIN_MISSING", "Dust bin is missing"},
        {"UI_ERROR_DUST_BIN_FULL", "Dust bin is full"},
        {"UI_ERROR_BATTERY_OVERTEMP", "Battery is too hot"},
        {"UI_ERROR_UNABLE_TO_RETURN_TO_BASE", "Could not return to base"},
        {"UI_ERROR_QA_FAIL", "Quality assurance test failed"},
        {"UI_ERROR_BUMPER_STUCK", "Bumper is stuck"},
        {"UI_ERROR_PICKED_UP", "Robot is picked up or tilted"},
        {"UI_ERROR_RECONNECT_FAILED", "Failed to reconnect"},
        {"UI_ERROR_LWHEEL_STUCK", "Left wheel is stuck"},
        {"UI_ERROR_RWHEEL_STUCK", "Right wheel is stuck"},
        {"UI_ERROR_LDS_JAMMED", "LIDAR turret is jammed"},
        {"UI_ERROR_LDS_DISCONNECTED", "LIDAR is disconnected"},
        {"UI_ERROR_LDS_MISSED_PACKETS", "LIDAR missed packets"},
        {"UI_ERROR_LDS_BAD_PACKETS", "LIDAR bad packets"},
        {"UI_ERROR_LDS_LASER_OVER_POWER", "LIDAR laser over power"},
        {"UI_ERROR_LDS_LASER_UNDER_POWER", "LIDAR laser under power"},
        {"UI_ERROR_BRUSH_STUCK", "Main brush is stuck"},
        {"UI_ERROR_BRUSH_OVERLOAD", "Main brush is overloaded"},
        {"UI_ERROR_VACUUM_STUCK", "Vacuum motor is stuck"},
        {"UI_ERROR_VACUUM_SLIP", "Vacuum motor is slipping"},
        {"UI_ERROR_BATTERY_CRITICAL", "Battery critically low"},
        {"UI_ERROR_BATTERY_OverVolt", "Battery over-voltage"},
        {"UI_ERROR_BATTERY_UnderVolt", "Battery under-voltage"},
        {"UI_ERROR_BATTERY_UnderCurrent", "Battery under-current"},
        {"UI_ERROR_BATTERY_Mismatch", "Battery mismatch detected"},
        {"UI_ERROR_BATTERY_LithiumAdapterFailure", "Lithium battery adapter failure"},
        {"UI_ERROR_BATTERY_UnderTemp", "Battery is too cold"},
        {"UI_ERROR_BATTERY_Unplugged", "Battery is unplugged"},
        {"UI_ERROR_BATTERY_NoThermistor", "Battery thermistor missing"},
        {"UI_ERROR_BATTERY_BattUnderVoltLithiumSafety", "Battery under-voltage safety cutoff"},
        {"UI_ERROR_BATTERY_InvalidSensor", "Battery sensor is invalid"},
        {"UI_ERROR_BATTERY_PermanentError", "Permanent battery error"},
        {"UI_ERROR_BATTERY_Fault", "Battery fault"},
        {"UI_ERROR_NAVIGATION_UndockingFailed", "Failed to undock from base"},
        {"UI_ERROR_NAVIGATION_Falling", "Robot detected a cliff"},
        {"UI_ERROR_NAVIGATION_PinkyCommsFail", "Navigation sensor communication failure"},
        {"UI_ERROR_NAVIGATION_NoMotionCommands", "No motion commands received"},
        {"UI_ERROR_NAVIGATION_BackDrop_LeftBump", "Rear drop sensor triggered with left bump"},
        {"UI_ERROR_NAVIGATION_BackDrop_FrontBump", "Rear drop sensor triggered with front bump"},
        {"UI_ERROR_NAVIGATION_BackDrop_WheelExtended", "Rear drop sensor triggered with wheel extended"},
        {"UI_ERROR_NAVIGATION_RightDrop_LeftBump", "Right drop sensor triggered with left bump"},
        {"UI_ERROR_NAVIGATION_NoExitsToGo", "No exits available to continue"},
        {"UI_ERROR_NAVIGATION_PathProblems_ReturningHome", "Path problems while returning home"},
        {"UI_ERROR_NAVIGATION_NoProgress", "Robot is stuck"},
        {"UI_ERROR_NAVIGATION_BadMagSensor", "Magnetic sensor error"},
        {"UI_ERROR_NAVIGATION_Origin_Unclean", "Could not clean starting area"},
        {"UI_ERROR_NAVIGATION_PathBlocked_GoingToZone", "Path to zone is blocked"},
        {"UI_ERROR_SHUTDOWN", "Robot is shutting down"},
        {"UI_ERROR_DFLT_APP", "Default application error"},
        {"UI_ERROR_CORRUPT_SCB", "Corrupt system configuration"},
        {"UI_ERROR_SCB_FLASH_READ", "System config flash read error"},
        {"UI_ERROR_SCB_SIGNATURE", "System config signature error"},
        {"UI_ERROR_SCB_LENGTH_MISMATCH", "System config length mismatch"},
        {"UI_ERROR_SCB_CHECKSUM", "System config checksum error"},
        {"UI_ERROR_SCB_VALIDATION", "System config validation error"},
        {"UI_ERROR_SCB_INTERFACE", "System config interface error"},
        {"UI_ERROR_HARDWARE_FAILURE", "Hardware failure"},
        {"UI_ERROR_DECK_DEBRIS", "Clear debris from brush deck"},
        {"UI_ERROR_RDROP_STUCK", "Right drop sensor is stuck"},
        {"UI_ERROR_LDROP_STUCK", "Left drop sensor is stuck"},
        {"UI_ERROR_UNABLE_TO_SEE", "Navigation sensors blocked"},
        {"UI_ERROR_TILTED_ON_CLEANING_STARTUP", "Robot was tilted at cleaning start"},
        {"UI_ERROR_SWUPDATE_FILEMISSING", "Firmware update file missing"},
        {"UI_ERROR_FLIGHT_SENSOR_DISCONNECTED", "Floor sensor disconnected"},
        {"UI_ERROR_WIFIPSWDORROUTERISSUE", "WiFi password or router issue"},
        {"UI_ERROR_CONNECTINGTOSERVER", "Could not connect to server"},
        {"UI_ERROR_TIMEDOUTCONNECTROUTER", "Timed out connecting to router"},
};

// Alerts (UI_ALERT_*) - informational
static const ErrorMessage ALERT_MESSAGES[] = {
        {"UI_ALERT_RETURN_TO_BASE_PWR", "Returning to base (low power)"},
        {"UI_ALERT_RETURN_TO_BASE", "Returning to base"},
        {"UI_ALERT_RETURN_TO_START", "Returning to start"},
        {"UI_ALERT_RETURN_TO_CHARGE", "Returning to charge"},
        {"UI_ALERT_DUST_BIN_FULL", "Dust bin full"},
        {"UI_ALERT_BUSY_CHARGING", "Busy charging"},
        {"UI_ALERT_OLD_ERROR", "Previous error cleared"},
        {"UI_ALERT_RECOVERING_LOCATION", "Recovering location"},
        {"UI_ALERT_INFO_THANK_YOU", "Cleaning complete"},
        {"UI_ALERT_LOG_READ_FAIL", "Failed to read log"},
        {"UI_ALERT_LOG_WRITE_FAIL", "Failed to write log"},
        {"UI_ALERT_USB_DISCONNECTED", "USB disconnected"},
        {"UI_ALERT_SWUPDATE_SUCCESS", "Firmware update successful"},
        {"UI_ALERT_SWUPDATE_FAIL", "Firmware update failed"},
        {"UI_ALERT_LOG_WRITE_SUCCESS", "Log saved successfully"},
        {"UI_ALERT_TIME_NOT_SET", "Clock is not set"},
        {"UI_ALERT_TIME_SET", "Clock has been set"},
        {"UI_ALERT_TIMER_SET", "Schedule timer set"},
        {"UI_ALERT_TIMER_REMOVED", "Schedule timer removed"},
        {"UI_ALERT_ENABLE_TIMER", "Schedule timer enabled"},
        {"UI_ALERT_CHARGING_POWER", "Charging via power adapter"},
        {"UI_ALERT_CHARGING_BASE", "Charging on base"},
        {"UI_ALERT_BATTERY_ChargeBaseCommErr", "Charge base communication error"},
        {"UI_ALERT_CONNECT_CHRG_CABLE", "Connect charging cable"},
        {"UI_ALERT_WAIT_FOR_POWER_SWITCH_DETECT", "Waiting for power switch"},
        {"UI_ALERT_LINKEDAPP", "App linked"},
        {"UI_ALERT_ORIGIN_UNCLEAN", "Could not clean starting area"},
        {"UI_ALERT_LOGUPLOAD_FAIL", "Log upload failed"},
        {"UI_ALERT_BRUSH_CHANGE", "Time to replace the brush"},
        {"UI_ALERT_FILTER_CHANGE", "Time to replace the filter"},
        {"UI_ALERT_PERSISTENT_RELOCALIZATION_FAIL", "Failed to relocalize on saved map"},
        {"UI_ALERT_TRAINING_MULTIPLE_FLOORPLANS_VALID", "Multiple floor plans found during training"},
        {"UI_ALERT_MULTIPLE_FLOORPLANS_VALID", "Multiple floor plans detected"},
        {"UI_ALERT_PM_LOAD_FAIL", "Failed to load persistent map"},
        {"UI_ALERT_PM_SETUP_FAIL", "Failed to set up persistent map"},
        {"UI_ALERT_ACQUIRING_PERSISTENT_MAP_IDS", "Acquiring map data"},
        {"UI_ALERT_CREATING_AND_UPLOADING_MAP", "Creating and saving map"},
        {"UI_ALERT_PM_START_CLEAN_FAIL", "Failed to start cleaning with map"},
        {"UI_ALERT_NAV_FLOORPLAN_NOT_CREATED", "Floor plan not yet created"},
        {"UI_ALERT_NAV_FLOORPLAN_ZONE_UNREACHABLE", "Zone is unreachable"},
        {"UI_ALERT_NAV_FLOORPLAN_ZONE_WRONG_FLOOR", "Zone is on a different floor"},
        {"UI_ALERT_TRAINING_MAP_SPARSE", "Training map is too sparse"},
};

// Look up a human-readable message for a UI_ERROR_* or UI_ALERT_* token.
// Returns empty string if not found.
static String lookupDisplayMessage(const String& raw) {
    // Search for all known error tokens first (higher priority)
    for (const auto& entry: ERROR_MESSAGES) {
        if (raw.indexOf(entry.token) >= 0)
            return entry.message;
    }
    // Then alert tokens
    for (const auto& entry: ALERT_MESSAGES) {
        if (raw.indexOf(entry.token) >= 0)
            return entry.message;
    }
    return "";
}

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
            {"hasError", hasError ? "true" : "false", FIELD_BOOL}, {"kind", kind, FIELD_STRING},
            {"errorCode", String(errorCode), FIELD_INT},           {"errorMessage", errorMessage, FIELD_STRING},
            {"displayMessage", displayMessage, FIELD_STRING},
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
    // Try labels in order: "Model" (D3-D7), "Product Model" (older), "ModelID" (XV-series)
    if (findCsvValue(raw, "Model", val) || findCsvValue(raw, "Product Model", val) ||
        findCsvValue(raw, "ModelID", val)) {
        // Value may have a trailing part number: "BotVacD7Connected,905-0415"
        // or a leading index: "0,XV11"
        int comma = val.indexOf(',');
        if (comma > 0) {
            // Check if prefix is numeric (ModelID format: "0,XV11")
            String prefix = val.substring(0, comma);
            bool numericPrefix = true;
            for (unsigned int i = 0; i < prefix.length(); i++) {
                if (!isDigit(prefix.charAt(i))) {
                    numericPrefix = false;
                    break;
                }
            }
            if (numericPrefix) {
                val = val.substring(comma + 1);
            } else {
                val = prefix;
            }
            val.trim();
            if (val.endsWith(","))
                val = val.substring(0, val.length() - 1);
        }
        out.modelName = val;
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
    // Parse "Time UTC" field, format: "Sat Apr 11 19:26:13 2026"
    if (findCsvValue(raw, "Time UTC", val)) {
        val.trim();
        struct tm tm = {};
        // Skip day-of-week prefix (e.g. "Sat ")
        int space = val.indexOf(' ');
        if (space > 0) {
            String rest = val.substring(space + 1);
            static const char *months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
            // Parse "Apr 11 19:26:13 2026"
            String monStr = rest.substring(0, 3);
            int mon = -1;
            for (int i = 0; i < 12; i++) {
                if (monStr.equalsIgnoreCase(months[i])) {
                    mon = i;
                    break;
                }
            }
            int day = 0, hour = 0, min = 0, sec = 0, year = 0;
            if (mon >= 0 && sscanf(rest.c_str() + 4, "%d %d:%d:%d %d", &day, &hour, &min, &sec, &year) == 5 &&
                year >= 2020) {
                // Compute UTC epoch directly (avoids mktime which applies local TZ)
                static const int cumDays[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
                int y = year - 1;
                long days = 365L * (year - 1970) + (y / 4 - y / 100 + y / 400) - (1969 / 4 - 1969 / 100 + 1969 / 400);
                days += cumDays[mon] + day - 1;
                if (mon > 1 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)))
                    days++; // leap year adjustment
                out.timeUtc = static_cast<time_t>(days) * 86400 + hour * 3600 + min * 60 + sec;
            }
        }
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
    // The response may contain Error and Alert sections, each with a numeric code.
    // Code 200 = UI_ALERT_INVALID = no error; skip it and keep scanning for real codes.
    // Return the first non-200 code found, with the full raw response as errorMessage
    // so the frontend can extract all UI_ERROR_*/UI_ALERT_* tokens.
    out.hasError = false;
    out.errorCode = 200;
    out.errorMessage = "";

    // Search all lines for code patterns "NNN - ..."
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
            if (code > 0 && code != 200) {
                out.hasError = true;
                out.errorCode = code;
                out.kind = (code >= 201 && code <= 242) ? "warning" : "error";
                out.errorMessage = trimmed;
                out.displayMessage = lookupDisplayMessage(trimmed);
                if (out.displayMessage.isEmpty()) {
                    out.displayMessage = "Robot reported error " + String(code);
                }
                return true;
            }
        }
        searchFrom = dashPos + 3;
    }
    return true;
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


// -- User settings -----------------------------------------------------------

std::vector<Field> UserSettingsData::toFields() const {
    return {
            {"buttonClick", buttonClick ? "true" : "false", FIELD_BOOL},
            {"melodies", melodies ? "true" : "false", FIELD_BOOL},
            {"warnings", warnings ? "true" : "false", FIELD_BOOL},
            {"ecoMode", ecoMode ? "true" : "false", FIELD_BOOL},
            {"intenseClean", intenseClean ? "true" : "false", FIELD_BOOL},
            {"binFullDetect", binFullDetect ? "true" : "false", FIELD_BOOL},
            {"wifi", wifi ? "true" : "false", FIELD_BOOL},
            {"stealthLed", stealthLed ? "true" : "false", FIELD_BOOL},
            {"filterChange", String(filterChange), FIELD_INT},
            {"brushChange", String(brushChange), FIELD_INT},
            {"dirtBin", String(dirtBin), FIELD_INT},
    };
}

bool UserSettingsData::fromFields(const std::vector<Field>& fields) {
    bool applied = false;
    const Field *f;
    if ((f = findField(fields, "buttonClick"))) {
        buttonClick = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "melodies"))) {
        melodies = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "warnings"))) {
        warnings = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "ecoMode"))) {
        ecoMode = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "intenseClean"))) {
        intenseClean = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "binFullDetect"))) {
        binFullDetect = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "wifi"))) {
        wifi = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "stealthLed"))) {
        stealthLed = f->value == "true";
        applied = true;
    }
    if ((f = findField(fields, "filterChange"))) {
        filterChange = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "brushChange"))) {
        brushChange = f->value.toInt();
        applied = true;
    }
    if ((f = findField(fields, "dirtBin"))) {
        dirtBin = f->value.toInt();
        applied = true;
    }
    return applied;
}

// GetUserSettings response format: "Label, Value\r\n" pairs (note space after comma).
// Labels use descriptive names with spaces, e.g. "ClickSounds, OFF", "Eco Mode, ON",
// "Filter Change Time (seconds), 43200". The findCsvValue helper matches the label
// prefix before the first comma, so we match the exact label strings from the robot.
bool parseUserSettingsData(const String& raw, UserSettingsData& out) {
    String val;
    bool found = false;
    if (findCsvValue(raw, "ClickSounds", val)) {
        out.buttonClick = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "Melody Sounds", val)) {
        out.melodies = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "Warning Sounds", val)) {
        out.warnings = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "Eco Mode", val)) {
        out.ecoMode = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "IntenseClean", val)) {
        out.intenseClean = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "Bin Full Detect", val)) {
        out.binFullDetect = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "WiFi", val)) {
        out.wifi = val.equalsIgnoreCase("ON");
        found = true;
    }
    if (findCsvValue(raw, "LED", val)) {
        // "LED" controls standby indicator lights (StealthLED in Neato app terms).
        // ON = LEDs visible (not stealth), OFF = LEDs hidden (stealth mode).
        // We invert: stealthLed=true means LEDs are off.
        out.stealthLed = val.equalsIgnoreCase("OFF");
        found = true;
    }
    if (findCsvValue(raw, "Filter Change Time (seconds)", val))
        out.filterChange = val.toInt();
    if (findCsvValue(raw, "Brush Change Time (seconds)", val))
        out.brushChange = val.toInt();
    if (findCsvValue(raw, "Dirt Bin Alert Reminder Interval (minutes)", val))
        out.dirtBin = val.toInt();
    return found;
}

// -- Robot position ----------------------------------------------------------

std::vector<Field> RobotPosData::toFields() const {
    return {
            {"raw", raw, FIELD_STRING},
    };
}

bool parseRobotPosData(const String& raw, RobotPosData& out) {
    // Response format unknown — just capture the raw response verbatim.
    out.raw = raw;
    out.raw.trim();
    return out.raw.length() > 0;
}

// -- Model support -----------------------------------------------------------

bool isSupportedModel(const String& modelName) {
    // Supported: Botvac D3-D7 only (and Connected variants)
    // Raw values from robot: "BotVacD7Connected", "BotVacD5", etc.
    String lower = modelName;
    lower.toLowerCase();
    if (lower.startsWith("botvacd")) {
        char digit = lower.charAt(7);
        return digit >= '3' && digit <= '7';
    }
    return false;
}

// -- SKey computation --------------------------------------------------------

String computeSKey(const String& serialNumber) {
    // Extract 12-char MAC from serial number (format: "XXX,MAC,X")
    int comma = serialNumber.indexOf(',');
    if (comma < 0)
        return "";
    String mac = serialNumber.substring(comma + 1, comma + 13);
    if (mac.length() != 12)
        return "";

    // RC4 key schedule with Neato's fixed seed
    static const uint8_t seed[] = {0x68, 0x36, 0x43, 0x58, 0x09, 0x09, 0x3A, 0x3C, 0x2A, 0x7B, 0x59};
    uint8_t s[256];
    for (int i = 0; i < 256; i++)
        s[i] = i;

    int j = 0;
    for (int i = 0; i < 256; i++) {
        j = (j + s[i] + seed[i % 11]) & 0xFF;
        uint8_t tmp = s[i];
        s[i] = s[j];
        s[j] = tmp;
    }

    // RC4 PRGA — generate 12 keystream bytes
    uint8_t ks[12];
    int ii = 0;
    j = 0;
    for (int k = 0; k < 12; k++) {
        ii = (ii + 1) & 0xFF;
        j = (j + s[ii]) & 0xFF;
        uint8_t tmp = s[ii];
        s[ii] = s[j];
        s[j] = tmp;
        ks[k] = s[(s[ii] + s[j]) & 0xFF];
    }

    // XOR keystream with MAC characters, hex-encode
    char result[26]; // 12 * 2 + 1 trailing char + null
    for (int k = 0; k < 12; k++) {
        snprintf(&result[k * 2], 3, "%02x", ks[k] ^ (uint8_t) mac.charAt(k));
    }
    // Brainslug quirk: append result[len/2] at the end
    result[24] = result[6];
    result[25] = '\0';

    return String(result);
}
