#ifndef ASYNC_CACHE_H
#define ASYNC_CACHE_H

#include <Arduino.h>
#include <functional>
#include <vector>

// Generic async cache with TTL, request deduplication, and explicit invalidation.
//
// T must be default-constructible. The cache stores the last successful value
// and a timestamp. Subsequent requests within the TTL window return the cached
// value instantly. If a fetch is already in flight, new requesters are queued
// and all receive the same result when it arrives.
//
// Usage:
//   AsyncCache<ChargerData> cache(2000, [this](auto cb) { fetchCharger(cb); });
//   cache.get([](bool ok, const ChargerData& d) { ... });

template<typename T>
class AsyncCache {
public:
    using Callback = std::function<void(bool, const T&)>;
    using FetchFunc = std::function<void(Callback)>;

    // ttlMs: how long a cached value is considered fresh (milliseconds)
    // fetchFunc: the async producer — must eventually call its callback exactly once
    AsyncCache(unsigned long ttlMs, FetchFunc fetchFunc) : ttl(ttlMs), fetcher(fetchFunc) {}

    // Request the value. Returns cached data instantly if fresh, otherwise
    // triggers a fetch (or piggybacks on an in-flight one).
    void get(Callback callback) {
        // Cache hit — value is fresh
        if (hasValue && (millis() - cachedAt < ttl)) {
            if (callback)
                callback(true, cached);
            return;
        }

        // Add to waiters list
        if (callback)
            waiters.push_back(callback);

        // If a fetch is already in flight, this request will be served when it completes
        if (fetching)
            return;

        // Trigger a new fetch
        fetching = true;
        fetcher([this](bool ok, const T& data) {
            fetching = false;

            if (ok) {
                cached = data;
                cachedAt = millis();
                hasValue = true;
            }

            // Deliver to all waiters — move the vector to avoid re-entrancy issues
            // (a waiter's callback could call get() again)
            auto pending = std::move(waiters);
            waiters.clear();
            for (auto& cb: pending) {
                cb(ok, ok ? cached : data);
            }
        });
    }

    // Mark cached value as stale — next get() will trigger a fresh fetch.
    void invalidate() { hasValue = false; }

    // Check whether a cached value exists (regardless of freshness)
    bool hasCached() const { return hasValue; }

    // Get the last cached value directly (for non-async access patterns)
    const T& getCached() const { return cached; }

private:
    unsigned long ttl;
    FetchFunc fetcher;

    T cached;
    unsigned long cachedAt = 0;
    bool hasValue = false;
    bool fetching = false;
    std::vector<Callback> waiters;
};

#endif // ASYNC_CACHE_H
