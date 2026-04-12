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
