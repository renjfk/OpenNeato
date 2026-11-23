#ifndef UPDATE_VERIFIER_H
#define UPDATE_VERIFIER_H

#include <Arduino.h>
#include <mbedtls/sha256.h>

#include "ota_public_keys.h"

// Signed update token verification.
//
// Every published firmware binary has a sibling "<asset>.token" release file:
//
//     v1|<board>|<version>|<size>|<sha256>|<sig>
//
// <sig> is a raw 64-byte ECDSA P-256 signature (r||s, hex encoded) over the
// canonical payload "v1|<board>|<version>|<size>|<sha256>". The matching public
// keys are compiled in (OTA_PUBLIC_KEYS), so a genuine release can be recognised
// without TLS and without a shared secret that would have to ship in the
// firmware. Binding the board stops a C3 image from landing on a XIAO build.
class UpdateToken {
public:
    // Parse and fully validate a token before any flash write: format, board,
    // version (must be newer than the running one), image size, and signature.
    // expectedVersion, when set, must match the signed version exactly; the
    // automatic path uses it so a token cannot stand in for another release
    // advertised over plain HTTP.
    bool authorize(const String& token, String& error, const String& expectedVersion = "");

    // Drop all state from a previous attempt (signed or not). Safe to call at
    // any point in the update lifecycle.
    void clear();

    // Streaming SHA-256 over the received image, compared with the token.
    void beginHash();
    void updateHash(uint8_t *data, size_t len);
    bool finishHash(String& error);

    const String& getVersion() const { return version; }
    size_t getSize() const { return size; }
    bool isActive() const { return authorized; }

private:
    bool authorized = false;
    String payload; // signed bytes: v1|board|version|size|sha256
    String version;
    String sha256;
    size_t size = 0;

    mbedtls_sha256_context hashCtx;
    bool hashActive = false;
    size_t hashedBytes = 0;
};

// Compare dotted numeric versions ("0.15", "0.15.1"). Returns >0 if a is newer,
// <0 if b is newer, 0 if equal. Missing parts count as zero.
int compareVersions(const String& a, const String& b);

// True when at least one compiled-in key is populated (an unfilled slot is all
// zeroes, see ota_public_keys.h). Builds without a key cannot verify signed
// updates and do not advertise them.
bool updateKeysConfigured();

#endif // UPDATE_VERIFIER_H
