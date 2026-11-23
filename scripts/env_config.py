"""
PlatformIO build script: inject environment variables and produce release artifacts.

Pre-build:
    FIRMWARE_VERSION  — injected as -DFIRMWARE_VERSION build flag
                        If not set, auto-generates "0.0-<git-hash>"
                        (final fallback in config.h: "0.0")
    OTA_HOST          — sets OTA upload target host (required for *-ota envs)
    BUILD_FRONTEND=1  — run frontend build (npm run build) before compiling

Post-build (*-release envs only):
    Produces release artifacts in release/ using flash offsets and chip name
    read directly from the PlatformIO build environment — no external scripts
    or intermediate files needed. GoReleaser uploads these as GitHub release assets.

Usage:
    pio run -e c3-debug                                  # auto version: 0.0-a1b2c3d
    FIRMWARE_VERSION=1.2 pio run -e c3-debug             # explicit version: 1.2
    OTA_HOST=10.10.10.15 pio run -e c3-ota -t upload
    BUILD_FRONTEND=1 pio run -e c3-debug                 # builds frontend + firmware
    BUILD_FRONTEND=1 OTA_HOST=10.10.10.15 pio run -e c3-ota -t upload
"""

import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

Import("env")


def _define_value(env, key):
    """Read a -D value from either CPPDEFINES or the raw BUILD_FLAGS.

    Pre-build scripts run before PlatformIO expands build_flags into
    CPPDEFINES, so both sources are needed: pre-build reads BUILD_FLAGS,
    post-build reads CPPDEFINES.
    """
    for define in env.get("CPPDEFINES") or []:
        if isinstance(define, (list, tuple)) and len(define) == 2:
            if define[0] == key:
                return str(define[1])
        elif isinstance(define, str) and define.startswith(key + "="):
            return define.split("=", 1)[1]

    for flag in env.get("BUILD_FLAGS") or []:
        if flag.startswith("-D" + key + "="):
            return flag.split("=", 1)[1]
    return None


def resolve_release_name(env):
    """Release artifact name for this build.

    OPENNEATO_RELEASE_ID can distinguish board-specific builds that use the same
    underlying chip, e.g. Seeed XIAO ESP32C3 vs generic ESP32-C3. Falls back to
    CHIP_MODEL for existing release artifact names. The same value is compiled in
    as BOARD_ID so signed update tokens can be matched to the running build.
    """
    value = _define_value(env, "OPENNEATO_RELEASE_ID") or _define_value(env, "CHIP_MODEL")
    if not value:
        return None
    return value.replace('\\"', '"').strip('"').lower()


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

# -- BOARD_ID ------------------------------------------------------------------
# Compiled in so a signed update token (which names a board) can be matched
# against the running build. Same value the release artifacts are named after,
# resolved here because it depends on build flags.

board_id = resolve_release_name(env)
if board_id:
    env.Append(CPPDEFINES=[("BOARD_ID", '\\"%s\\"' % board_id)])

# -- OTA_HOST (OTA upload) -----------------------------------------------------

host = os.environ.get("OTA_HOST")
if host:
    env.Replace(UPLOAD_PORT=host)
elif env["PIOENV"].endswith("-ota") and "upload" in COMMAND_LINE_TARGETS:
    sys.exit(
        "Error: OTA_HOST is required for OTA uploads. "
        "Usage: OTA_HOST=<ip> pio run -e <board>-ota -t upload"
    )

# -- Release artifacts (*-release builds) --------------------------------------
# After building firmware.bin, package release artifacts directly from the
# PlatformIO build environment. Reads flash offsets, image paths, and chip
# name from SCons variables — no intermediate files or external scripts.
#
# Produces in the build dir (e.g. .pio/build/c3-release/):
#   openneato-<chip>-firmware.bin  — app binary for OTA updates
#   openneato-<chip>-full.tar.gz  — full flash pack for the flash tool
#
# GoReleaser picks these up via extra_files globs at release time.


def package_release(source, target, env):
    build_dir = env.subst("$BUILD_DIR")

    release_name = resolve_release_name(env)
    if not release_name:
        sys.exit("Error: CHIP_MODEL not found in build flags — cannot package release")

    flash_images = env.get("FLASH_EXTRA_IMAGES", [])
    if len(flash_images) < 3:
        sys.exit(
            "Error: expected at least 3 flash extra images (bootloader, partitions, boot_app0)"
        )

    app_offset = env.subst("$ESP32_APP_OFFSET")
    firmware_bin = os.path.join(build_dir, "firmware.bin")

    # (offset, label, source_path) for each image in the flash pack
    images = [
        (flash_images[0][0], "bootloader.bin", env.subst(flash_images[0][1])),
        (flash_images[1][0], "partitions.bin", env.subst(flash_images[1][1])),
        (flash_images[2][0], "boot_app0.bin", env.subst(flash_images[2][1])),
        (app_offset, "firmware.bin", firmware_bin),
    ]

    # OTA firmware binary
    ota_name = f"openneato-{release_name}-firmware.bin"
    shutil.copy2(firmware_bin, os.path.join(build_dir, ota_name))

    # Full flash pack tarball
    pack_name = f"openneato-{release_name}-full.tar.gz"
    offsets = {
        "bootloader": images[0][0],
        "partitions": images[1][0],
        "otadata": images[2][0],
        "app": images[3][0],
    }

    with tempfile.TemporaryDirectory() as tmp:
        for _, label, src in images:
            shutil.copy2(src, os.path.join(tmp, label))
        with open(os.path.join(tmp, "offsets.json"), "w") as f:
            json.dump(offsets, f)

        with tarfile.open(os.path.join(build_dir, pack_name), "w:gz") as tar:
            for name in os.listdir(tmp):
                tar.add(os.path.join(tmp, name), arcname=name)

    print(f"Release artifacts for {release_name}:")
    print(f"  {os.path.join(build_dir, ota_name)}")
    print(f"  {os.path.join(build_dir, pack_name)}")
    for offset, label, _ in images:
        print(f"    {label}: {offset}")


if env["PIOENV"].endswith("-release"):
    env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", package_release)
