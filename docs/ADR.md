# Architecture Decision Records

Key technical decisions made while building the Distributed Ride-Matching Engine, along with two real bugs found and fixed during development.

---

## ADR-1: Redis Geospatial over a SQL spatial index (PostGIS)

**Decision:** Use Redis's built-in GEO commands (GEOADD, GEOSEARCH) for driver location and nearest-driver queries, instead of a SQL database with spatial indexing (e.g., PostgreSQL + PostGIS).

**Why:** Driver locations change constantly and are read far more often than written durably — this is fundamentally a hot, ephemeral, high-frequency workload, not a transactional one. Redis Geo gives O(log N) radius queries backed by an in-memory sorted set (geohash-encoded), which is a natural fit for this access pattern. PostGIS would give more powerful spatial queries (polygons, complex geometry) but at higher latency for the simple "nearest N points" query this system actually needs.

**Trade-off accepted:** Redis Geo has no persistence guarantee by default — a Redis restart loses driver positions (acceptable, since drivers re-report location every few seconds anyway) — and it can't do anything beyond radius/distance queries. If the system needed complex geofencing or historical location analytics, a hybrid approach (Redis for hot lookups, PostGIS for historical/complex queries) would be more appropriate.

---

## ADR-2: Redlock over a simple Redis SETNX lock

**Decision:** Use the Redlock algorithm (via the `redlock` npm package) for driver-assignment locking, rather than a plain `SET key value NX EX ttl`.

**Why:** A single `SETNX` lock is correctness-sufficient against a *single* Redis instance, but Redlock is designed for correctness across multiple independent Redis nodes (quorum-based acquisition) — which matters if the system ever scales Redis itself horizontally (Redis Cluster / multiple masters), not just the application servers. Using Redlock from day one meant the locking layer wouldn't need to change if Redis itself became distributed later.

**Trade-off accepted:** Redlock adds retry/quorum overhead compared to a bare `SETNX` — for this project's scale, a simple lock would have been operationally simpler. This was a deliberate choice to demonstrate the more general-purpose pattern.

---

## ADR-3: Redis Sets over KEYS-based scanning for demand tracking

**Original approach:** Surge-pricing demand tracking used `redis.keys('demand:rider:*')` to count active riders.

**Problem found:** `KEYS` performs an O(N) scan across the *entire* Redis keyspace and blocks the Redis event loop while running — acceptable for a demo with a handful of keys, but a genuine production hazard at scale (a large keyspace would cause latency spikes for every other client during the scan).

**Fix:** Replaced with a Redis Set (`SADD`/`SMEMBERS`/`SREM`), scoped only to active demand signals, with a per-rider TTL key used to detect and sweep stale entries. This keeps the operation bounded to the size of the demand set itself, not the whole database.

**Why this matters:** This is the kind of thing that looks fine in a demo and fails silently in production — catching and fixing it was a deliberate exercise in not shipping code that "just happens to work" at small scale.

---

## Bug Case Study 1: Unhandled Redis disconnection crashed the entire process

**Discovery method:** Deliberate chaos testing — stopped the Redis container mid-traffic to observe system behavior under infrastructure failure.

**What happened:** Route handlers issued `await redis.someCommand()` calls with no `try/catch`. When Redis became unreachable, ioredis's promise rejections went unhandled, and Node.js's default behavior is to terminate the process on an unhandled promise rejection — so a Redis blip took down the *entire backend*, not just the affected request.

**Fix:**
1. Wrapped every Redis-dependent route in `try/catch`, returning a clean `503 Service Unavailable` instead of letting the error propagate.
2. Configured ioredis with `maxRetriesPerRequest` and a bounded `retryStrategy`, so a command fails fast (within ~1-2 seconds) instead of hanging indefinitely waiting for reconnection — the original bug re-surfaced here as a *hang* rather than a crash, and needed a second, distinct fix.

**Verification:** Re-ran the same chaos test after the fix — the server now returns `503` responses cleanly, stays alive throughout the outage, and automatically resumes normal operation once Redis reconnects, with zero manual intervention.

**Why this matters:** This is the exact class of bug that's invisible until you deliberately break the system — most projects never test failure paths at all, so this crash would only have been discovered in production, under real user load, at the worst possible time.

---

## Bug Case Study 2: Redis GEO silently discards position data on removal

**Discovery method:** Building and testing the trip-cancellation feature.

**What happened:** When a driver is matched to a rider, they're removed from the Redis Geo set (`ZREM`) so they stop appearing in nearby-driver searches while busy. On trip cancellation, the code attempted to look up the driver's last position via `GEOPOS` to re-insert them — but Redis's GEO commands are backed by a sorted set, and once a member is removed, its associated position data is gone. `GEOPOS` returned `null`, and the driver was permanently lost from the searchable pool after any cancellation.

**Fix:** Before removing a driver from the Geo set on match, their last known coordinates are now explicitly persisted to a separate Redis key (`driver:{id}:lastpos`). Cancellation reads from this key instead of relying on `GEOPOS`, which cannot recover data for a removed member.

**Why this matters:** This bug wouldn't surface in a happy-path demo (successful matches never trigger the cancellation code path) — it only appears when exercising a specific state transition, which is exactly the kind of edge case that's easy to miss without deliberately testing every lifecycle branch (assign → cancel, not just assign → complete).