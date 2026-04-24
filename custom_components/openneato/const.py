"""Constants for the OpenNeato integration."""

from homeassistant.components.vacuum import VacuumActivity

DOMAIN = "openneato"
CONF_HOST = "host"
DEFAULT_POLL_INTERVAL = 5  # seconds

# The firmware returns uiState as full enum strings like "UIMGR_STATE_HOUSECLEANINGRUNNING".
# We match using substrings (via .includes() style) like the frontend does in dashboard.tsx.
# These substring keys are checked against the raw uiState value.
UISTATE_SUBSTRINGS: list[tuple[str, VacuumActivity]] = [
    ("CLEANINGRUNNING", VacuumActivity.CLEANING),
    ("MANUALCLEANING", VacuumActivity.CLEANING),
    ("CLEANINGPAUSED", VacuumActivity.PAUSED),
    ("CLEANINGSUSPENDED", VacuumActivity.PAUSED),
    ("DOCKING", VacuumActivity.RETURNING),
]

FAN_SPEEDS = ["eco", "normal", "intense"]

# ── LIDAR map camera ────────────────────────────────────────────────
LIDAR_POLL_INTERVAL = 2  # seconds, only while robot is active
LIDAR_IMAGE_SIZE = 480  # pixels (square)
LIDAR_MAX_RANGE_MM = 5000  # display radius
LIDAR_MAX_DIST_MM = 6000  # reject readings above this
LIDAR_MAX_SCAN_AGE = 5  # keep points from the last N scans
LIDAR_MAX_BRIDGE_GAP = 5  # bridge up to N missing angles
LIDAR_MAX_DIST_JUMP_PCT = 0.3  # 30% — max jump to consider same surface
LIDAR_SMOOTH_WINDOW = 5  # moving-average half-window
LIDAR_MIN_SEGMENT_LEN = 3  # min points to draw a wall segment

# Colors (RGB tuples for PIL)
LIDAR_BG_COLOR = (30, 30, 34)  # #1E1E22
LIDAR_GRID_COLOR = (42, 42, 48)  # #2A2A30
LIDAR_WALL_COLOR = (91, 164, 245)  # #5BA4F5 — desaturated blue, colorblind-safe
LIDAR_ROBOT_COLOR = (138, 138, 142)  # #8A8A8E

# ── History (cleaning session) map ──────────────────────────────────
HISTORY_IMAGE_SIZE = 480  # pixels (square)
HISTORY_ROBOT_DIAMETER_M = 0.33  # Neato Botvac diameter
HISTORY_CELL_SIZE_M = 0.05  # 5cm grid cells for coverage
HISTORY_PAD_PX = 20  # canvas padding
HISTORY_GRID_STEP_M = 0.5  # grid line spacing

HISTORY_BG_COLOR = (30, 30, 34)  # #1E1E22 — same dark bg as LIDAR
HISTORY_GRID_COLOR = (255, 255, 255, 10)  # very subtle white
HISTORY_COVERAGE_COLOR = (52, 199, 89, 38)  # rgba(52, 199, 89, 0.15)
HISTORY_PATH_COLOR = (249, 235, 178, 153)  # rgba(249, 235, 178, 0.6)
HISTORY_START_COLOR = (52, 199, 89, 230)  # green
HISTORY_END_COLOR = (255, 69, 58, 230)  # red
# Warm orange, deliberately distinct from the gold path color so the
# bolt icon reads clearly even when a recharge point sits on top of a
# drawn path segment. Matches vacuum-dashboard conventions for "event".
HISTORY_RECHARGE_COLOR = (255, 160, 51)

# ── Animated motion-replay camera ──────────────────────────────────
# The animation compresses a full session into a short loop regardless
# of the real cleaning duration. Plays once (loop=1) then holds on the
# fully-drawn map so the dashboard settles on a static final image
# rather than spinning forever.
MOTION_FRAMES = 30
MOTION_TOTAL_MS = 7000
MOTION_TAIL_FRAMES = 10  # ~1/3 of the loop holds the final map
# Render-time cap on the path/coverage fed into the GIF encoder — long
# sessions (40+ min, 2000+ poses) would otherwise spend seconds in the
# executor and produce megabyte-scale GIFs. Subsampling preserves the
# first/last pose so start and end markers still sit on real data.
MOTION_MAX_PATH_POINTS = 500

# ── API hardening ───────────────────────────────────────────────────
# Session name flows from the ESP32's /api/history response into the
# next URL path segment, so validate it before concatenation to stop
# a rogue/compromised robot (or LAN MITM over plain HTTP) from
# redirecting requests to other endpoints.
SESSION_NAME_PATTERN = r"^\d+\.jsonl(\.hs)?$"
# Upper bound on /api/history/<name> responses. Real sessions on the
# 1MB SPIFFS history budget cap below this; a larger payload implies a
# misbehaving peer and we refuse to load it into HA Core.
MAX_HISTORY_RESPONSE_BYTES = 2 * 1024 * 1024
