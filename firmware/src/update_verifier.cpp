#include "update_verifier.h"

#include <mbedtls/ecdsa.h>
#include <mbedtls/ecp.h>
#include <mbedtls/bignum.h>
#include <cstdlib>

#include "config.h"

// Uses the mbedTLS 2.x API shipped with Arduino core 2.0.x. The _ret SHA-256
// functions disappear in mbedTLS 3.x, so revisit this file when the core moves.

static const uint8_t KEY_POINT_MARKER = 0x04;

// Decode a hex string into bytes. Returns false on odd length or non-hex input.
static bool decodeHex(const String& hex, uint8_t *out, size_t outLen) {
    if (hex.length() != outLen * 2) {
        return false;
    }
    for (size_t i = 0; i < outLen; i++) {
        char c1 = hex.charAt(i * 2);
        char c2 = hex.charAt(i * 2 + 1);
        int hi = (c1 >= '0' && c1 <= '9') ? c1 - '0' : (c1 >= 'a' && c1 <= 'f') ? c1 - 'a' + 10 : -1;
        int lo = (c2 >= '0' && c2 <= '9') ? c2 - '0' : (c2 >= 'a' && c2 <= 'f') ? c2 - 'a' + 10 : -1;
        if (hi < 0 || lo < 0) {
            return false;
        }
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

static bool isHex(const String& value) {
    if (value.isEmpty()) {
        return false;
    }
    for (unsigned int i = 0; i < value.length(); i++) {
        char c = value.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            return false;
        }
    }
    return true;
}

// A key slot that was never filled in (see ota_public_keys.h) is all zeroes.
static bool isConfiguredKey(const uint8_t *key) {
    if (key[0] != KEY_POINT_MARKER) {
        return false;
    }
    for (size_t i = 1; i < 65; i++) {
        if (key[i] != 0) {
            return true;
        }
    }
    return false;
}

bool updateKeysConfigured() {
    for (size_t i = 0; i < OTA_PUBLIC_KEY_MAX; i++) {
        if (isConfiguredKey(OTA_PUBLIC_KEYS[i])) {
            return true;
        }
    }
    return false;
}

static bool verifyWithKey(const uint8_t *key, const uint8_t *hash, const uint8_t *signature) {
    bool ok = false;
    mbedtls_ecdsa_context ctx;
    mbedtls_ecdsa_init(&ctx);

    if (mbedtls_ecp_group_load(&ctx.grp, MBEDTLS_ECP_DP_SECP256R1) == 0 &&
        mbedtls_ecp_point_read_binary(&ctx.grp, &ctx.Q, key, 65) == 0) {
        mbedtls_mpi r;
        mbedtls_mpi s;
        mbedtls_mpi_init(&r);
        mbedtls_mpi_init(&s);
        // Trusted, length-checked input, so the zero-check variants are not needed.
        if (mbedtls_mpi_read_binary(&r, signature, 32) == 0 && mbedtls_mpi_read_binary(&s, signature + 32, 32) == 0) {
            ok = mbedtls_ecdsa_verify(&ctx.grp, hash, 32, &ctx.Q, &r, &s) == 0;
        }
        mbedtls_mpi_free(&r);
        mbedtls_mpi_free(&s);
    }

    mbedtls_ecdsa_free(&ctx);
    return ok;
}

void UpdateToken::clear() {
    if (hashActive) {
        mbedtls_sha256_free(&hashCtx);
        hashActive = false;
    }
    hashedBytes = 0;
    authorized = false;
    payload = "";
    version = "";
    sha256 = "";
    size = 0;
}

bool UpdateToken::authorize(const String& token, String& error, const String& expectedVersion) {
    clear();

    // v1|<board>|<version>|<size>|<sha256>|<sig>
    String parts[6];
    int partCount = 0;
    int start = 0;
    while (partCount < 6) {
        int sep = token.indexOf('|', start);
        if (sep < 0) {
            parts[partCount++] = token.substring(start);
            break;
        }
        parts[partCount++] = token.substring(start, sep);
        start = sep + 1;
    }
    if (partCount != 6 || token.indexOf('|', start) >= 0) {
        error = "Update token malformed";
        return false;
    }

    const String& format = parts[0];
    const String& board = parts[1];
    const String& tokenVersion = parts[2];
    const String& sizeText = parts[3];
    const String& tokenSha256 = parts[4];
    const String& signatureHex = parts[5];

    if (format != "v1") {
        error = "Update token version not supported";
        return false;
    }
    if (board != BOARD_ID) {
        error = "Update is for " + board + ", this device is " + BOARD_ID;
        return false;
    }
    if (!isHex(tokenSha256) || tokenSha256.length() != 64) {
        error = "Update token hash malformed";
        return false;
    }
    // Version rule: never downgrade below the running base version, and never
    // reinstall the exact same build. A prerelease of the same base (e.g.
    // 0.15-pr220.abc1234 on a 0.15 device) is allowed because the user picked
    // it explicitly from the release list.
    int versionCmp = compareVersions(tokenVersion, FIRMWARE_VERSION);
    if (versionCmp < 0 || (versionCmp == 0 && tokenVersion == FIRMWARE_VERSION)) {
        error = "Update is not newer than running firmware";
        return false;
    }

    unsigned long declaredSize = strtoul(sizeText.c_str(), nullptr, 10);
    if (declaredSize < 64 || declaredSize > OTA_MAX_IMAGE_BYTES) {
        error = "Update size out of range";
        return false;
    }

    uint8_t signature[64];
    if (!decodeHex(signatureHex, signature, sizeof(signature))) {
        error = "Update signature malformed";
        return false;
    }

    payload = parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3] + "|" + tokenSha256;

    uint8_t hash[32];
    mbedtls_sha256(reinterpret_cast<const unsigned char *>(payload.c_str()), payload.length(), hash, 0);

    bool verified = false;
    for (size_t i = 0; i < OTA_PUBLIC_KEY_MAX; i++) {
        if (!isConfiguredKey(OTA_PUBLIC_KEYS[i])) {
            continue;
        }
        if (verifyWithKey(OTA_PUBLIC_KEYS[i], hash, signature)) {
            verified = true;
            break;
        }
    }
    if (!verified) {
        error = "Update signature invalid";
        return false;
    }

    if (!expectedVersion.isEmpty() && tokenVersion != expectedVersion) {
        error = "Update token does not match the advertised version";
        return false;
    }

    version = tokenVersion;
    sha256 = tokenSha256;
    size = declaredSize;
    authorized = true;
    return true;
}

void UpdateToken::beginHash() {
    if (hashActive) {
        mbedtls_sha256_free(&hashCtx); // Previous attempt never reached finishHash
    }
    mbedtls_sha256_init(&hashCtx);
    mbedtls_sha256_starts_ret(&hashCtx, 0);
    hashActive = true;
    hashedBytes = 0;
}

void UpdateToken::updateHash(uint8_t *data, size_t len) {
    if (hashActive && len) {
        mbedtls_sha256_update_ret(&hashCtx, data, len);
        hashedBytes += len;
    }
}

bool UpdateToken::finishHash(String& error) {
    if (!hashActive) {
        return true; // No token, nothing to check
    }
    uint8_t hash[32];
    mbedtls_sha256_finish_ret(&hashCtx, hash);
    hashActive = false;

    // Image must be exactly what was signed. Size and hash together also rule
    // out a truncated download that Update.end() would otherwise accept.
    if (!authorized || !size) {
        return true;
    }
    if (hashedBytes != size) {
        error = "Update size mismatch";
        return false;
    }
    char hex[65];
    for (size_t i = 0; i < 32; i++) {
        snprintf(hex + i * 2, 3, "%02x", hash[i]);
    }
    if (!sha256.equalsIgnoreCase(String(hex))) {
        error = "Update hash mismatch";
        return false;
    }
    return true;
}

int compareVersions(const String& a, const String& b) {
    int numsA[4] = {0, 0, 0, 0};
    int numsB[4] = {0, 0, 0, 0};

    auto parse = [](const String& v, int out[4]) {
        String work = v;
        if (work.startsWith("v") || work.startsWith("V")) {
            work = work.substring(1);
        }
        int idx = work.indexOf('-');
        if (idx >= 0) {
            work = work.substring(0, idx);
        }
        int part = 0;
        int start = 0;
        while (part < 4) {
            int dot = work.indexOf('.', start);
            String segment = dot < 0 ? work.substring(start) : work.substring(start, dot);
            if (!segment.length()) {
                break;
            }
            out[part++] = segment.toInt();
            if (dot < 0) {
                break;
            }
            start = dot + 1;
        }
    };

    parse(a, numsA);
    parse(b, numsB);
    for (int i = 0; i < 4; i++) {
        if (numsA[i] != numsB[i]) {
            return numsA[i] > numsB[i] ? 1 : -1;
        }
    }
    return 0;
}
