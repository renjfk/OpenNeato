#ifndef NEATO_COMMANDS_H
#define NEATO_COMMANDS_H

#include <Arduino.h>
#include <vector>
#include "json_fields.h"

// -- Command enum ------------------------------------------------------------

enum NeatoCommand {
    CMD_GET_VERSION,
    CMD_GET_CHARGER,
    CMD_GET_ANALOG_SENSORS,
    CMD_GET_DIGITAL_SENSORS,
    CMD_GET_MOTORS,
    CMD_GET_STATE,
    CMD_GET_ERR,
    CMD_GET_ERR_CLEAR,
    CMD_GET_LDS_SCAN,
    CMD_GET_ACCEL,
    CMD_GET_BUTTONS,
    CMD_GET_SCHEDULE,
    CMD_GET_TIME,
    CMD_GET_CAL_INFO,
    CMD_GET_LIFE_STAT_LOG,
    CMD_GET_WARRANTY,
    CMD_CLEAN_HOUSE,
    CMD_CLEAN_SPOT,
    CMD_CLEAN_STOP,
    CMD_TEST_MODE_ON,
    CMD_TEST_MODE_OFF,
    CMD_SET_LDS_ROTATION_ON,
    CMD_SET_LDS_ROTATION_OFF,
    CMD_PLAY_SOUND,
    CMD_SET_TIME
};

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

// Lookup: enum -> command string to send over UART
const char *commandToString(NeatoCommand cmd);

// Lookup: enum -> timeout in ms
unsigned long commandTimeout(NeatoCommand cmd);

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

struct AnalogSensorData : public JsonSerializable {
    int batteryVoltage = 0; // mV
    int batteryCurrent = 0; // mA (negative = discharging)
    int batteryTemp = 0; // milli-Celsius
    int externalVoltage = 0; // mV
    int accelX = 0; // milli-G
    int accelY = 0; // milli-G
    int accelZ = 0; // milli-G
    int vacuumCurrent = 0; // mA
    int sideBrushCurrent = 0; // mA
    int magSensorLeft = 0;
    int magSensorRight = 0;
    int wallSensor = 0; // mm
    int dropSensorLeft = 0; // mm
    int dropSensorRight = 0; // mm

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
    int errorCode = 200; // 200 = UI_ALERT_INVALID = no error
    String errorMessage;

    std::vector<Field> toFields() const override;
};

struct AccelData : public JsonSerializable {
    float pitchDeg = 0.0f;
    float rollDeg = 0.0f;
    float xInG = 0.0f;
    float yInG = 0.0f;
    float zInG = 0.0f;
    float sumInG = 0.0f;

    std::vector<Field> toFields() const override;
};

struct ButtonData : public JsonSerializable {
    bool softKey = false;
    bool scrollUp = false;
    bool start = false;
    bool back = false;
    bool scrollDown = false;

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

// -- Response parsers --------------------------------------------------------

bool parseVersionData(const String& raw, VersionData& out);
bool parseChargerData(const String& raw, ChargerData& out);
bool parseAnalogSensorData(const String& raw, AnalogSensorData& out);
bool parseDigitalSensorData(const String& raw, DigitalSensorData& out);
bool parseMotorData(const String& raw, MotorData& out);
bool parseRobotState(const String& raw, RobotState& out);
bool parseErrorData(const String& raw, ErrorData& out);
bool parseAccelData(const String& raw, AccelData& out);
bool parseButtonData(const String& raw, ButtonData& out);
bool parseLdsScanData(const String& raw, LdsScanData& out);
bool parseTimeData(const String& raw, TimeData& out);

#endif // NEATO_COMMANDS_H
