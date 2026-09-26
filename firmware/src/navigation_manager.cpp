#include "navigation_manager.h"
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include "config.h"
#include "data_logger.h"
#include "json_fields.h"
#include "manual_clean_manager.h"
#include "neato_serial.h"

namespace {
    constexpr size_t MAX_WAYPOINTS = 64;
    constexpr size_t MAX_PAYLOAD_BYTES = 8192;
    constexpr unsigned long POSITION_POLL_MS = 1500;
    constexpr unsigned long ENABLE_TIMEOUT_MS = 12000;
    constexpr float ARRIVAL_DISTANCE_M = 0.15f;
    constexpr float HEADING_TOLERANCE_DEG = 12.0f;
    constexpr float TRACK_WIDTH_MM = 248.0f;
    constexpr int DRIVE_CHUNK_MM = 400;
    constexpr int TURN_CHUNK_MM = 250;
    constexpr int DRIVE_SPEED_MM_S = 100;
    constexpr int TURN_SPEED_MM_S = 80;
    constexpr float MAX_COORDINATE_ABS_M = 50.0f;
    constexpr float MAX_TARGET_DISTANCE_M = 15.0f;
    constexpr float MAX_ROUTE_DISTANCE_M = 100.0f;
    constexpr unsigned long MOVE_SETTLE_MARGIN_MS = 500;

    float normalizeHeading(float degrees) {
        degrees = fmodf(degrees, 360.0f);
        if (degrees > 180.0f)
            degrees -= 360.0f;
        if (degrees < -180.0f)
            degrees += 360.0f;
        return degrees;
    }

    void skipWhitespace(const char *& cursor) {
        while (*cursor && isspace(static_cast<unsigned char>(*cursor)))
            cursor++;
    }

    bool consume(const char *& cursor, char expected) {
        skipWhitespace(cursor);
        if (*cursor != expected)
            return false;
        cursor++;
        return true;
    }

    bool parseString(const char *& cursor, String& value) {
        skipWhitespace(cursor);
        if (*cursor++ != '"')
            return false;
        value = "";
        while (*cursor && *cursor != '"') {
            if (*cursor == '\\')
                return false;
            value += *cursor++;
        }
        if (*cursor != '"')
            return false;
        cursor++;
        return true;
    }

    bool parseNumber(const char *& cursor, float& value) {
        skipWhitespace(cursor);
        char *end = nullptr;
        value = strtof(cursor, &end);
        if (end == cursor || !isfinite(value))
            return false;
        cursor = end;
        return true;
    }
} // namespace

NavigationManager::NavigationManager(NeatoSerial& serial, ManualCleanManager& manual, DataLogger& logger) :
    LoopTask(0), serial(serial), manual(manual), logger(logger) {
    TaskRegistry::add(this);
}

bool NavigationManager::start(const String& body, String& error) {
    if (state == State::ENABLING || state == State::NAVIGATING || state == State::STOPPING) {
        error = "navigation already active";
        return false;
    }
    if (manual.isActive()) {
        error = "manual mode already active";
        return false;
    }

    std::vector<NavigationWaypoint> parsed;
    if (!parseWaypoints(body, parsed, error))
        return false;

    waypoints = parsed;
    waypointIndex = 0;
    hasPosition = false;
    positionPending = false;
    movePending = false;
    errorMessage = "";
    state = State::ENABLING;
    stateStartedMs = millis();
    lastClientActivityMs.store(stateStartedMs, std::memory_order_relaxed);
    const uint32_t session = ++generation;
    logger.logGenericEvent("navigation_start", {{"waypoints", String(waypoints.size()), FIELD_INT}});

    if (!manual.enableNavigation(true, [this, session](bool ok) {
            if (session != generation || state != State::ENABLING) {
                if (ok)
                    manual.enableNavigation(false, nullptr);
                return;
            }
            if (!ok) {
                finish(State::ERROR, "manual mode could not be enabled");
                return;
            }
            state = State::NAVIGATING;
            nextPositionPollMs = 0;
        })) {
        if (state == State::ENABLING)
            finish(State::ERROR, "manual mode unavailable");
        error = errorMessage.isEmpty() ? "manual mode unavailable" : errorMessage;
        return false;
    }
    return true;
}

void NavigationManager::stop() {
    if (state != State::ENABLING && state != State::NAVIGATING)
        return;
    finish(State::CANCELLED);
}

void NavigationManager::noteClientActivity() {
    lastClientActivityMs.store(millis(), std::memory_order_relaxed);
}

void NavigationManager::tick() {
    if (state == State::ENABLING && millis() - stateStartedMs >= ENABLE_TIMEOUT_MS) {
        finish(State::ERROR, "manual mode enable timed out");
        return;
    }
    if (state != State::NAVIGATING)
        return;
    const uint32_t lastClientActivity = lastClientActivityMs.load(std::memory_order_relaxed);
    if (millis() - lastClientActivity >= NAVIGATION_CLIENT_TIMEOUT_MS) {
        finish(State::ERROR, "navigation client heartbeat timed out");
        return;
    }
    if (manual.isWatchdogStopped()) {
        finish(State::ERROR, "client watchdog stopped navigation");
        return;
    }
    if (positionPending || movePending)
        return;
    unsigned long now = millis();
    if (nextPositionPollMs == 0 || static_cast<int32_t>(now - nextPositionPollMs) >= 0)
        pollPosition();
}

void NavigationManager::pollPosition() {
    positionPending = true;
    nextPositionPollMs = millis() + POSITION_POLL_MS;
    const uint32_t session = generation;
    serial.getRobotPos(true, [this, session](bool ok, const RobotPosData& position) {
        if (session != generation)
            return;
        positionPending = false;
        if (state != State::NAVIGATING)
            return;
        float x, y, theta;
        if (!ok || !parsePose(position.raw, x, y, theta)) {
            finish(State::ERROR, "robot position unavailable");
            return;
        }
        advanceFromPosition(x, y, theta);
    });
}

void NavigationManager::advanceFromPosition(float x, float y, float theta) {
    currentX = x;
    currentY = y;
    currentTheta = theta;
    hasPosition = true;

    while (waypointIndex < waypoints.size()) {
        const auto& target = waypoints[waypointIndex];
        float dx = target.x - x;
        float dy = target.y - y;
        float distance = sqrtf(dx * dx + dy * dy);
        if (distance > ARRIVAL_DISTANCE_M)
            break;
        waypointIndex++;
    }

    if (waypointIndex >= waypoints.size()) {
        finish(State::COMPLETE);
        return;
    }

    const auto& target = waypoints[waypointIndex];
    float dx = target.x - x;
    float dy = target.y - y;
    float distance = sqrtf(dx * dx + dy * dy);
    if (distance > MAX_TARGET_DISTANCE_M) {
        finish(State::ERROR, "waypoint is too far from the current robot position");
        return;
    }
    float targetHeading = atan2f(dy, dx) * 180.0f / PI;
    float headingError = normalizeHeading(targetHeading - theta);

    int leftMM;
    int rightMM;
    int speed;
    if (fabsf(headingError) > HEADING_TOLERANCE_DEG) {
        float arcMM = headingError * PI / 180.0f * TRACK_WIDTH_MM / 2.0f;
        int turnMM = constrain(static_cast<int>(roundf(arcMM)), -TURN_CHUNK_MM, TURN_CHUNK_MM);
        leftMM = -turnMM;
        rightMM = turnMM;
        speed = TURN_SPEED_MM_S;
    } else {
        int driveMM = min(DRIVE_CHUNK_MM, static_cast<int>(roundf(distance * 1000.0f)));
        leftMM = driveMM;
        rightMM = driveMM;
        speed = DRIVE_SPEED_MM_S;
    }

    unsigned long movementMs =
            static_cast<unsigned long>(max(abs(leftMM), abs(rightMM))) * 1000UL / static_cast<unsigned long>(speed);
    nextPositionPollMs = millis() + movementMs + MOVE_SETTLE_MARGIN_MS;
    movePending = true;
    const uint32_t session = generation;
    if (!manual.moveNavigation(leftMM, rightMM, speed, [this, session](bool ok) {
            if (session != generation)
                return;
            movePending = false;
            if (state == State::NAVIGATING && !ok)
                finish(State::ERROR, "movement blocked by safety system");
        })) {
        movePending = false;
        finish(State::ERROR, "movement command unavailable");
    }
}

void NavigationManager::finish(State finalState, const String& error) {
    ++generation;
    state = State::STOPPING;
    errorMessage = error;
    positionPending = false;
    movePending = false;
    auto complete = [this, finalState](bool teardownOk) {
        State completedState = teardownOk ? finalState : State::ERROR;
        if (!teardownOk && errorMessage.isEmpty())
            errorMessage = "navigation emergency teardown failed";
        state = completedState;
        logger.logGenericEvent(completedState == State::COMPLETE    ? "navigation_complete"
                               : completedState == State::CANCELLED ? "navigation_cancelled"
                                                                    : "navigation_error",
                               errorMessage.isEmpty() ? std::vector<Field>{}
                                                      : std::vector<Field>{{"error", errorMessage, FIELD_STRING}});
    };
    if (manual.isNavigationOwner()) {
        if (!manual.enableNavigation(false, complete))
            complete(false);
    } else {
        complete(true);
    }
}

String NavigationManager::getStatusJson() const {
    String json = "{\"state\":\"" + String(stateName(state)) +
                  "\",\"waypointIndex\":" + String(static_cast<unsigned int>(waypointIndex)) +
                  ",\"waypointCount\":" + String(static_cast<unsigned int>(waypoints.size())) +
                  ",\"hasPosition\":" + String(hasPosition ? "true" : "false");
    if (hasPosition) {
        json += ",\"position\":{\"x\":" + String(currentX, 3) + ",\"y\":" + String(currentY, 3) +
                ",\"theta\":" + String(currentTheta, 1) + "}";
    }
    if (!errorMessage.isEmpty())
        json += ",\"error\":\"" + jsonEscape(errorMessage) + "\"";
    json += "}";
    return json;
}

bool NavigationManager::parseWaypoints(const String& body, std::vector<NavigationWaypoint>& result, String& error) {
    if (body.length() > MAX_PAYLOAD_BYTES) {
        error = "waypoint payload is too large";
        return false;
    }
    const char *cursor = body.c_str();
    if (!consume(cursor, '[')) {
        error = "waypoint array required";
        return false;
    }
    skipWhitespace(cursor);
    if (*cursor == ']') {
        error = "at least one waypoint is required";
        return false;
    }

    float routeDistance = 0.0f;
    while (*cursor) {
        if (result.size() >= MAX_WAYPOINTS) {
            error = "too many waypoints";
            return false;
        }
        if (!consume(cursor, '{')) {
            error = "waypoint must be an object";
            return false;
        }
        NavigationWaypoint point;
        bool hasX = false;
        bool hasY = false;
        bool hasTheta = false;
        bool closed = false;
        while (*cursor) {
            String key;
            float value;
            if (!parseString(cursor, key) || !consume(cursor, ':') || !parseNumber(cursor, value)) {
                error = "invalid waypoint field";
                return false;
            }
            if (key == "x" && !hasX) {
                point.x = value;
                hasX = true;
            } else if (key == "y" && !hasY) {
                point.y = value;
                hasY = true;
            } else if (key == "t" && !hasTheta) {
                point.theta = value;
                hasTheta = true;
            } else {
                error = "waypoint requires unique x, y, and t fields";
                return false;
            }
            skipWhitespace(cursor);
            if (*cursor == '}') {
                cursor++;
                closed = true;
                break;
            }
            if (!consume(cursor, ',')) {
                error = "invalid waypoint object";
                return false;
            }
        }
        if (!closed || !hasX || !hasY || !hasTheta) {
            error = "waypoint requires x, y, and t";
            return false;
        }
        if (fabsf(point.x) > MAX_COORDINATE_ABS_M || fabsf(point.y) > MAX_COORDINATE_ABS_M ||
            fabsf(point.theta) > 360.0f) {
            error = "waypoint is outside the supported coordinate range";
            return false;
        }
        if (!result.empty()) {
            float dx = point.x - result.back().x;
            float dy = point.y - result.back().y;
            float segmentDistance = sqrtf(dx * dx + dy * dy);
            if (segmentDistance > MAX_TARGET_DISTANCE_M) {
                error = "waypoint segment is too long";
                return false;
            }
            routeDistance += segmentDistance;
            if (routeDistance > MAX_ROUTE_DISTANCE_M) {
                error = "waypoint route is too long";
                return false;
            }
        }
        result.push_back(point);
        skipWhitespace(cursor);
        if (*cursor == ']') {
            cursor++;
            skipWhitespace(cursor);
            if (*cursor != '\0') {
                error = "unexpected data after waypoint array";
                return false;
            }
            return true;
        }
        if (!consume(cursor, ',')) {
            error = "invalid waypoint array";
            return false;
        }
    }
    error = "unterminated waypoint array";
    return false;
}

bool NavigationManager::parsePose(const String& raw, float& x, float& y, float& theta) {
    auto parseField = [&raw](const char *label, float& value) {
        int position = raw.indexOf(label);
        if (position < 0)
            return false;
        const char *start = raw.c_str() + position + strlen(label);
        char *end = nullptr;
        value = strtof(start, &end);
        if (end == start || !isfinite(value))
            return false;
        return *end == 0 || *end == 13 || *end == 10 || *end == 32 || *end == 9 || *end == 44;
    };
    if (!parseField("X=", x) || !parseField("Y=", y) || !parseField("Theta=", theta))
        return false;
    return fabsf(x) <= 100.0f && fabsf(y) <= 100.0f && fabsf(theta) <= 360.0f;
}

const char *NavigationManager::stateName(State value) {
    switch (value) {
        case State::IDLE:
            return "idle";
        case State::ENABLING:
            return "enabling";
        case State::NAVIGATING:
            return "navigating";
        case State::STOPPING:
            return "stopping";
        case State::COMPLETE:
            return "complete";
        case State::CANCELLED:
            return "cancelled";
        case State::ERROR:
            return "error";
    }
    return "error";
}
