"""Constants for the OpenNeato integration."""

from homeassistant.components.vacuum import VacuumActivity

DOMAIN = "openneato"
CONF_HOST = "host"
DEFAULT_FAST_POLL_INTERVAL = 5  # seconds
DEFAULT_SLOW_POLL_INTERVAL = 30  # seconds

# Map OpenNeato uiState strings to VacuumActivity
# Note: IDLE requires runtime check of charger state to distinguish DOCKED vs IDLE
UISTATE_MAP: dict[str, VacuumActivity] = {
    "Cleaning": VacuumActivity.CLEANING,
    "Spot Cleaning": VacuumActivity.CLEANING,
    "Manual Cleaning": VacuumActivity.CLEANING,
    "Paused": VacuumActivity.PAUSED,
    "Suspended": VacuumActivity.PAUSED,
    "Docking": VacuumActivity.RETURNING,
    "Error": VacuumActivity.ERROR,
}

FAN_SPEEDS = ["eco", "normal", "intense"]
