"""
PlatformIO pre-build script: inject environment variables into build/upload config.

Supported variables:
    FIRMWARE_VERSION  — injected as -DFIRMWARE_VERSION build flag
                        If not set, auto-generates "0.0-<git-hash>"
                        (final fallback in config.h: "0.0")
    OTA_HOST          — sets OTA upload target host (required for OTA env)

Set BUILD_FRONTEND=1 to run the frontend build (npm run build) before
compiling firmware, ensuring web_assets.h is up to date.

Usage:
    pio run -e Debug                                  # auto version: 0.0-a1b2c3d
    FIRMWARE_VERSION=1.2 pio run -e Debug             # explicit version: 1.2
    OTA_HOST=10.10.10.15 pio run -e OTA -t upload
    BUILD_FRONTEND=1 pio run -e Debug                 # builds frontend + firmware
    BUILD_FRONTEND=1 OTA_HOST=10.10.10.15 pio run -e OTA -t upload
"""

import os
import subprocess
import sys

Import("env")

# -- Frontend build (Full environments) ----------------------------------------

if os.environ.get("BUILD_FRONTEND"):
    frontend_dir = os.path.join(env["PROJECT_DIR"], "frontend")
    print("Building frontend (npm run build)...")
    result = subprocess.run(["npm", "run", "build"], cwd=frontend_dir)
    if result.returncode != 0:
        sys.exit("Error: Frontend build failed")
    print("Frontend build complete")

# -- FIRMWARE_VERSION ----------------------------------------------------------

version = os.environ.get("FIRMWARE_VERSION")
if not version:
    # No explicit version — use git commit hash
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=env["PROJECT_DIR"],
            capture_output=True,
            text=True,
            check=True,
        )
        commit_hash = result.stdout.strip()
        version = f"0.0-{commit_hash}"
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Git not available or not a repo — fall back to config.h default
        version = None

if version:
    env.Append(CPPDEFINES=[("FIRMWARE_VERSION", '\\"%s\\"' % version)])

# -- OTA_HOST (OTA upload) -----------------------------------------------------

host = os.environ.get("OTA_HOST")
if host:
    env.Replace(UPLOAD_PORT=host)
elif env["PIOENV"] == "OTA" and "upload" in COMMAND_LINE_TARGETS:
    sys.exit(
        "Error: OTA_HOST is required for OTA uploads. "
        "Usage: OTA_HOST=<ip> pio run -e OTA -t upload"
    )
