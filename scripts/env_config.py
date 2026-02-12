"""
PlatformIO pre-build script: inject environment variables into build/upload config.

Supported variables:
    FIRMWARE_VERSION  — injected as -DFIRMWARE_VERSION build flag
                        (fallback in config.h: "0.0.0-dev")
    NEATO_HOST        — sets OTA upload target host (required for OTA env)

Usage:
    FIRMWARE_VERSION=1.2.3 pio run -e Debug
    NEATO_HOST=10.10.10.15 pio run -e OTA -t upload
"""

import os
import sys

Import("env")

# -- FIRMWARE_VERSION ----------------------------------------------------------

version = os.environ.get("FIRMWARE_VERSION")
if version:
    env.Append(CPPDEFINES=[("FIRMWARE_VERSION", '\\"%s\\"' % version)])

# -- NEATO_HOST (OTA upload) ---------------------------------------------------

host = os.environ.get("NEATO_HOST")
if host:
    env.Replace(UPLOAD_PORT=host)
elif env["PIOENV"] == "OTA":
    sys.exit("Error: NEATO_HOST is required for OTA uploads. "
             "Usage: NEATO_HOST=<ip> pio run -e OTA -t upload")
