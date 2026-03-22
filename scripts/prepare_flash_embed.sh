#!/bin/sh
#
# Creates release artifacts from PlatformIO build output.
# Reads flash offsets from idedata.json so nothing is hardcoded.
#
# Produces in release/:
#   openneato-<board>-firmware.bin   — app binary for OTA updates
#   openneato-<board>-full.tar.gz   — full flash pack (bootloader + partitions +
#                                     boot_app0 + firmware + offsets.json)
#
# Usage:
#   scripts/prepare_flash_embed.sh <chip> <pio-build-dir>
#
# Example:
#   scripts/prepare_flash_embed.sh esp32-c3 .pio/build/c3-release

set -eu

CHIP="${1:?Usage: $0 <chip> <pio-build-dir>}"
BUILD_DIR="${2:?Usage: $0 <chip> <pio-build-dir>}"
IDEDATA="$BUILD_DIR/idedata.json"
RELEASE_DIR="release"

if [ ! -f "$BUILD_DIR/firmware.bin" ]; then
    echo "Error: $BUILD_DIR/firmware.bin not found. Run pio build first." >&2
    exit 1
fi

if [ ! -f "$IDEDATA" ]; then
    echo "Error: $IDEDATA not found. Run: pio project metadata -e $(basename "$BUILD_DIR") --json-output | jq '.\"'$(basename "$BUILD_DIR")'\"' > $IDEDATA" >&2
    exit 1
fi

mkdir -p "$RELEASE_DIR"

# Extract offsets and paths from PlatformIO metadata
BL_OFFSET=$(jq -r '.extra.flash_images[0].offset' "$IDEDATA")
BL_PATH=$(jq -r '.extra.flash_images[0].path' "$IDEDATA")
PT_OFFSET=$(jq -r '.extra.flash_images[1].offset' "$IDEDATA")
PT_PATH=$(jq -r '.extra.flash_images[1].path' "$IDEDATA")
OD_OFFSET=$(jq -r '.extra.flash_images[2].offset' "$IDEDATA")
OD_PATH=$(jq -r '.extra.flash_images[2].path' "$IDEDATA")
APP_OFFSET=$(jq -r '.extra.application_offset' "$IDEDATA")

# Create temp dir for the full flash pack
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp "$BL_PATH" "$TMP/bootloader.bin"
cp "$PT_PATH" "$TMP/partitions.bin"
cp "$OD_PATH" "$TMP/boot_app0.bin"
cp "$BUILD_DIR/firmware.bin" "$TMP/firmware.bin"

jq -n \
    --arg bl "$BL_OFFSET" \
    --arg pt "$PT_OFFSET" \
    --arg od "$OD_OFFSET" \
    --arg app "$APP_OFFSET" \
    '{bootloader:$bl,partitions:$pt,otadata:$od,app:$app}' \
    > "$TMP/offsets.json"

# OTA firmware binary
cp "$BUILD_DIR/firmware.bin" "$RELEASE_DIR/openneato-${CHIP}-firmware.bin"

# Full flash pack tarball
tar -czf "$RELEASE_DIR/openneato-${CHIP}-full.tar.gz" -C "$TMP" .

echo "Release artifacts for $CHIP:"
echo "  $RELEASE_DIR/openneato-${CHIP}-firmware.bin"
echo "  $RELEASE_DIR/openneato-${CHIP}-full.tar.gz"
echo "  Offsets: bl=$BL_OFFSET pt=$PT_OFFSET od=$OD_OFFSET app=$APP_OFFSET"
