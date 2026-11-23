#!/usr/bin/env python3
"""
Check that firmware sources conform to .clang-format.

Usage:
    python scripts/check_format.py          # check (dry-run)
    python scripts/check_format.py --fix    # auto-fix in place

Skips generated files (web_assets*, ota_public_keys*).
"""

import glob
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
SRC_DIR = os.path.join(PROJECT_DIR, "firmware", "src")

sources = glob.glob(os.path.join(SRC_DIR, "*.cpp")) + glob.glob(
    os.path.join(SRC_DIR, "*.h")
)
GENERATED_PREFIXES = ("web_assets", "ota_public_keys")
sources = [f for f in sources if not os.path.basename(f).startswith(GENERATED_PREFIXES)]

if not sources:
    print("No source files to check")
    sys.exit(0)

if "--fix" in sys.argv:
    subprocess.run(["clang-format", "-i"] + sources, check=True)
    print(f"Formatted {len(sources)} files")
else:
    result = subprocess.run(
        ["clang-format", "--dry-run", "--Werror"] + sources,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        print("\nRun: python scripts/check_format.py --fix", file=sys.stderr)
        sys.exit(1)
    print(f"All {len(sources)} files formatted correctly")
