#!/usr/bin/env python3
"""Sign OpenNeato firmware images with an ECDSA P-256 release key.

Produces the "<binary>.token" release asset the firmware and the update Worker
use. See docs/firmware-signing.md for the token format.

Usage:
    # Sign every release binary in a build directory
    ./scripts/ota_sign.py sign --key release-key.pem --version 0.16 \
        --bin .pio/build/c3-release/openneato-esp32-c3-firmware.bin [...]

    # Verify an existing token (CI check, or debugging a rejected update)
    ./scripts/ota_sign.py verify --pubkey release-key.pub.pem --bin <bin> --token <token-file>

    # Print the token for a binary without writing a file
    ./scripts/ota_sign.py sign --key k.pem --version 0.16 --bin fw.bin --print
"""

import argparse
import hashlib
import os
import re
import subprocess
import sys
import tempfile

TOKEN_FORMAT = "v1"
BOARD_PATTERN = re.compile(r"openneato-(?P<board>[a-z0-9-]+)-firmware\.bin$")


def board_from_filename(path):
    match = BOARD_PATTERN.search(os.path.basename(path))
    if not match:
        sys.exit(f"error: cannot derive board id from {path} (expected openneato-<board>-firmware.bin)")
    return match.group("board")


def sha256_hex(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def der_to_raw(der):
    """Convert an ASN.1 DER ECDSA signature to raw r||s (32 + 32 bytes)."""
    if len(der) < 8 or der[0] != 0x30:
        sys.exit("error: unexpected signature encoding (not a DER SEQUENCE)")

    # Skip the SEQUENCE header (tag + length, short or long form).
    index = 1
    length = der[index]
    index += 1
    if length & 0x80:
        count = length & 0x7F
        index += count

    def read_integer(pos):
        if der[pos] != 0x02:
            sys.exit("error: unexpected signature encoding (not a DER INTEGER)")
        size = der[pos + 1]
        start = pos + 2
        value = der[start:start + size]
        # Strip the sign byte(s) DER adds to keep the integer positive.
        value = value.lstrip(b"\x00")
        if len(value) > 32:
            sys.exit("error: signature component longer than 32 bytes")
        return value.rjust(32, b"\x00"), start + size

    r, position = read_integer(index)
    s, _ = read_integer(position)
    return r + s


def build_payload(board, version, size, digest):
    return f"{TOKEN_FORMAT}|{board}|{version}|{size}|{digest}"


def sign(key_path, board, version, bin_path):
    size = os.path.getsize(bin_path)
    digest = sha256_hex(bin_path)
    payload = build_payload(board, version, size, digest)

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = os.path.join(tmp, "payload")
        signature_path = os.path.join(tmp, "signature.der")
        with open(payload_path, "wb") as handle:
            handle.write(payload.encode())
        subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path, "-out", signature_path, payload_path],
            check=True,
        )
        with open(signature_path, "rb") as handle:
            raw = der_to_raw(handle.read())

    return f"{payload}|{raw.hex()}"


def verify(pubkey_path, bin_path, token):
    fields = token.strip().split("|")
    if len(fields) != 6:
        return False, "token must have six fields"
    fmt, board, version, size, digest, signature_hex = fields
    if fmt != TOKEN_FORMAT:
        return False, f"unsupported token format {fmt}"
    if str(os.path.getsize(bin_path)) != size:
        return False, f"size mismatch: token says {size}, file is {os.path.getsize(bin_path)}"
    actual = sha256_hex(bin_path)
    if actual != digest:
        return False, "sha256 mismatch"
    if board != board_from_filename(bin_path):
        return False, f"token is for board {board}, file is {board_from_filename(bin_path)}"

    payload = "|".join(fields[:5]).encode()
    raw = bytes.fromhex(signature_hex)
    if len(raw) != 64:
        return False, "signature must be 64 raw bytes"

    # Re-encode raw r||s as DER so openssl can check it.
    def encode_integer(value):
        value = value.lstrip(b"\x00") or b"\x00"
        if value[0] & 0x80:
            value = b"\x00" + value
        return b"\x02" + bytes([len(value)]) + value

    body = encode_integer(raw[:32]) + encode_integer(raw[32:])
    der = b"\x30" + bytes([len(body)]) + body

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = os.path.join(tmp, "payload")
        signature_path = os.path.join(tmp, "signature.der")
        with open(payload_path, "wb") as handle:
            handle.write(payload)
        with open(signature_path, "wb") as handle:
            handle.write(der)
        result = subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", pubkey_path, "-signature", signature_path, payload_path],
            capture_output=True,
        )

    if result.returncode != 0:
        return False, "signature does not match the public key"
    return True, f"{version} verified"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sign_parser = sub.add_parser("sign", help="sign firmware binaries and write <binary>.token")
    sign_parser.add_argument("--key", required=True, help="private key (PEM)")
    sign_parser.add_argument("--version", required=True, help="release version, e.g. 0.16")
    sign_parser.add_argument("--bin", required=True, action="append", help="firmware binary (repeatable)")
    sign_parser.add_argument("--print", dest="print_token", action="store_true", help="print token instead of writing")

    verify_parser = sub.add_parser("verify", help="verify a token against a binary")
    verify_parser.add_argument("--pubkey", required=True, help="public key (PEM)")
    verify_parser.add_argument("--bin", required=True)
    verify_parser.add_argument("--token", required=True, help="token file, or the token itself")

    args = parser.parse_args()

    if args.command == "sign":
        for bin_path in args.bin:
            board = board_from_filename(bin_path)
            token = sign(args.key, board, args.version, bin_path)
            if args.print_token:
                print(token)
            else:
                token_path = bin_path + ".token"
                with open(token_path, "w") as handle:
                    handle.write(token + "\n")
                print(f"signed {board} {args.version}: {token_path}")
        return

    token = args.token
    if os.path.exists(token):
        with open(token) as handle:
            token = handle.read()
    ok, message = verify(args.pubkey, args.bin, token)
    print(("ok: " if ok else "FAIL: ") + message)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
