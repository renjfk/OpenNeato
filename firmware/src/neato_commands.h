#ifndef NEATO_COMMANDS_H
#define NEATO_COMMANDS_H

#include <Arduino.h>
#include <vector>
#include "json_fields.h"

// -- Command constants -------------------------------------------------------

#define CMD_GET_VERSION "GetVersion"
#define CMD_GET_CHARGER "GetCharger"
#define CMD_GET_DIGITAL_SENSORS "GetDigitalSensors"
#define CMD_GET_MOTORS "GetMotors"
#define CMD_GET_STATE "GetState"
#define CMD_GET_ERR "GetErr"
#define CMD_GET_ERR_CLEAR "GetErr Clear"
#define CMD_GET_LDS_SCAN "GetLDSScan"

#define CMD_GET_TIME "GetTime"
#define CMD_GET_CAL_INFO "GetCalInfo"
#define CMD_GET_LIFE_STAT_LOG "GetLifeStatLog"
#define CMD_GET_WARRANTY "GetWarranty"
#define CMD_CLEAN "Clean"
#define CMD_CLEAN_HOUSE "Clean House"
#define CMD_CLEAN_SPOT "Clean Spot"
#define CMD_CLEAN_STOP "Clean Stop"
#define CMD_TEST_MODE_ON "TestMode On"
#define CMD_TEST_MODE_OFF "TestMode Off"
#define CMD_SET_LDS_ROTATION_ON "SetLDSRotation On"
#define CMD_SET_LDS_ROTATION_OFF "SetLDSRotation Off"
#define CMD_PLAY_SOUND "PlaySound"
#define CMD_SET_TIME "SetTime"

// -- SetEvent constants (D3-D7, requires SKey) --------------------------------
#define CMD_SET_EVENT_PREFIX "SetEvent event "
#define CMD_SET_EVENT_SKEY " SKey "
#define EVT_START_HOUSE "UIMGR_EVENT_SMARTAPP_START_HOUSE_CLEANING"
#define EVT_START_SPOT "UIMGR_EVENT_SMARTAPP_START_SPOT_CLEANING"
#define EVT_PAUSE "UIMGR_EVENT_SMARTAPP_PAUSE_CLEANING"
#define EVT_RESUME "UIMGR_EVENT_SMARTAPP_RESUME_CLEANING"
#define EVT_STOP "UIMGR_EVENT_SMARTAPP_STOP_CLEANING"
#define EVT_SEND_TO_BASE "UIMGR_EVENT_SMARTAPP_SEND_TO_BASE"
#define CMD_SET_MOTOR "SetMotor"
#define CMD_SET_SYSTEM_MODE_POWER_CYCLE "SetSystemMode PowerCycle"
#define CMD_SET_SYSTEM_MODE_SHUTDOWN "SetSystemMode Shutdown"
#define CMD_GET_ROBOT_POS_RAW "GetRobotPos Raw"
#define CMD_GET_ROBOT_POS_SMOOTH "GetRobotPos Smooth"
#define CMD_GET_USER_SETTINGS "GetUserSettings"
#define CMD_SET_USER_SETTINGS "SetUserSettings"

// -- Sound IDs ---------------------------------------------------------------

enum SoundId {
    SOUND_WAKING_UP = 0,
    SOUND_STARTING_CLEANING = 1,
    SOUND_CLEANING_COMPLETED = 2,
    SOUND_ATTENTION_NEEDED = 3,
    SOUND_BACKING_UP_INTO_BASE = 4,
    SOUND_DOCKING_COMPLETED = 5,
    SOUND_TEST_1 = 6,
    SOUND_TEST_2 = 7,
    SOUND_TEST_3 = 8,
    SOUND_TEST_4 = 9,
    SOUND_TEST_5 = 10,
    SOUND_EXPLORING = 11,
    SOUND_SHUTDOWN = 12,
    SOUND_PICKED_UP = 13,
    SOUND_GOING_TO_SLEEP = 14,
    SOUND_RETURNING_HOME = 15,
    SOUND_USER_CANCELED_CLEANING = 16,
    SOUND_USER_TERMINATED_CLEANING = 17,
    SOUND_SLIPPED_OFF_BASE = 18,
    SOUND_ALERT = 19,
    SOUND_THANK_YOU = 20
};

// -- Response structs --------------------------------------------------------

struct VersionData : public JsonSerializable {
    String modelName;
    String serialNumber;
    String softwareVersion; // "Major.Minor.Build"
    String ldsVersion;
    String ldsSerial;
    String mainBoardVersion;

    std::vector<Field> toFields() const override;
};

struct ChargerData : public JsonSerializable {
    int fuelPercent = -1;
    bool batteryOverTemp = false;
    bool chargingActive = false;
    bool chargingEnabled = false;
    bool confidOnFuel = false;
    bool onReservedFuel = false;
    bool emptyFuel = false;
    bool batteryFailure = false;
    bool extPwrPresent = false;
    float vBattV = 0.0f;
    float vExtV = 0.0f;
    int chargerMAH = 0;
    int dischargeMAH = 0;

    std::vector<Field> toFields() const override;
};

struct DigitalSensorData : public JsonSerializable {
    bool dcJackIn = false;
    bool dustbinIn = false;
    bool leftWheelExtended = false;
    bool rightWheelExtended = false;
    bool lSideBit = false;
    bool lFrontBit = false;
    bool lLdsBit = false;
    bool rSideBit = false;
    bool rFrontBit = false;
    bool rLdsBit = false;

    std::vector<Field> toFields() const override;
};

struct MotorData : public JsonSerializable {
    int brushMaxPWM = 0;
    int brushRPM = 0;
    int brushMA = 0;
    int vacuumRPM = 0;
    int vacuumMA = 0;
    int leftWheelRPM = 0;
    int leftWheelLoad = 0;
    int leftWheelPositionMM = 0;
    int leftWheelSpeed = 0;
    int rightWheelRPM = 0;
    int rightWheelLoad = 0;
    int rightWheelPositionMM = 0;
    int rightWheelSpeed = 0;
    int sideBrushMA = 0;
    int laserRPM = 0;

    std::vector<Field> toFields() const override;
};

struct RobotState : public JsonSerializable {
    String uiState; // e.g. "UIMGR_STATE_STANDBY"
    String robotState; // e.g. "ST_C_Standby"

    std::vector<Field> toFields() const override;
};

struct ErrorData : public JsonSerializable {
    bool hasError = false;
    String kind; // "error" (codes 243+) or "warning" (codes 201-242)
    int errorCode = 200; // 200 = UI_ALERT_INVALID = no error
    String errorMessage; // Full raw response (for diagnostics/logging)
    String displayMessage; // Human-readable message for UI and notifications

    std::vector<Field> toFields() const override;
};

struct TimeData : public JsonSerializable {
    int dayOfWeek = -1; // 0=Sunday .. 6=Saturday
    int hour = 0;
    int minute = 0;
    int second = 0;

    std::vector<Field> toFields() const override;
};

// LDS scan — special case, does not use toFields()
struct LdsScanPoint {
    int angleDeg = 0;
    int distMM = 0;
    int intensity = 0;
    int errorCode = 0;
};

struct LdsScanData {
    LdsScanPoint points[360];
    float rotationSpeed = 0.0f;
    int validPoints = 0;

    // Custom serializer (array data doesn't map to flat fields)
    String toJson() const;
};

// Robot user settings — read via GetUserSettings, write via SetUserSettings.
// Boolean flags are ON/OFF; interval fields are in seconds or minutes.
struct UserSettingsData : public JsonSerializable {
    // Sound control
    bool buttonClick = true;
    bool melodies = true;
    bool warnings = true;
    // Cleaning behavior
    bool ecoMode = false;
    bool intenseClean = false;
    bool binFullDetect = true;
    // Power saving
    bool wifi = true;
    bool stealthLed = false;
    // Maintenance reminders (seconds for filter/brush, minutes for dirt bin)
    int filterChange = 2592000; // 30 days
    int brushChange = 2592000; // 30 days
    int dirtBin = 30; // 30 minutes

    std::vector<Field> toFields() const override;
    bool fromFields(const std::vector<Field>& fields) override;
};

// Robot position — hidden command, response format unknown.
// Returns the raw response verbatim for inspection on real hardware.
struct RobotPosData : public JsonSerializable {
    String raw; // Full raw response — parse once format is known

    std::vector<Field> toFields() const override;
};

// -- Response parsers --------------------------------------------------------

bool parseVersionData(const String& raw, VersionData& out);
bool parseChargerData(const String& raw, ChargerData& out);
bool parseDigitalSensorData(const String& raw, DigitalSensorData& out);
bool parseMotorData(const String& raw, MotorData& out);
bool parseRobotState(const String& raw, RobotState& out);
bool parseErrorData(const String& raw, ErrorData& out);
bool parseLdsScanData(const String& raw, LdsScanData& out);
bool parseTimeData(const String& raw, TimeData& out);
bool parseRobotPosData(const String& raw, RobotPosData& out);
bool parseUserSettingsData(const String& raw, UserSettingsData& out);

// -- Model support -----------------------------------------------------------
// Checks if the parsed model name matches a supported Botvac (D3-D7).

bool isSupportedModel(const String& modelName);

// -- SKey computation --------------------------------------------------------
// Computes the SetEvent security key from the robot's serial number (which
// contains a 12-char MAC address after the first comma). Uses RC4 with a
// fixed seed derived from Neato's cloud protocol.

String computeSKey(const String& serialNumber);

#endif // NEATO_COMMANDS_H
