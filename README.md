# Distributed Ride Matching Engine

![CI](https://github.com/zenabkabir9829/distributed-ride-matching/actions/workflows/ci.yml/badge.svg)

A ride-hailing dispatch backend inspired by Uber's matching system. It focuses on the hard parts of the problem: fast geospatial lookups, making sure two riders can never claim the same driver, recovering cleanly from partial failures, and pushing updates to drivers in real time.

**Live demo:** [distributed-ride-matching-six.vercel.app](https://distributed-ride-matching-six.vercel.app/)

## How it works

1. **Drivers report location** via `POST /driver/:id/location`. Positions are stored in Redis with `GEOADD` (`drivers:locations`).
2. **Riders find nearby drivers** via `GET /riders/nearby-drivers`, which runs `GEOSEARCH ... BYRADIUS ... ASC` (nearest first). The rider UI polls this every 3 seconds.
3. **Ride request** (`POST /rides/request`) takes a Redlock on `lock:driver:{id}`, so concurrent requests for the same driver are serialized and only one can win.
4. **Assignment**, while holding the lock:
   1. Check the driver isn't already `busy`.
   2. Compute distance and ETA (haversine, 25 km/h assumed average speed).
   3. Set the busy flag (with a TTL) and save the driver's last position.
   4. Create the `Trip` in MongoDB.
   5. Remove the driver from the geo set so they can't be matched again.
   6. Push `new_ride_request` to the driver over WebSocket.
5. **If any step after the busy flag fails**, a compensating rollback cancels the trip, restores the driver to the geo set, and clears the busy flag. The caller gets a `503`-style "service temporarily unavailable" result, not a stuck driver.
6. **Complete / cancel** (`POST /rides/:tripId/complete|cancel`) update the trip, clear the busy flag, and put the driver back in the geo set (at the end location, or at their saved last position on cancel). Both sides are notified over WebSocket.
7. **Surge pricing** (`GET /pricing/surge`) compares active rider demand (a Redis set, with a 60s per-rider TTL key) with available drivers within 5 km: ratio below 1 gives 1.0x, then 1.2x, 1.5x, 2.0x at ratios of 1, 2 and 3, and 2.5x when no drivers are available. Riders register demand via `POST /rides/demand-signal`.

### Real-time delivery

WebSocket connections are held per process. To make this work with several backend instances behind a load balancer, every `sendToUser` call delivers locally if the user is connected to this instance, then publishes the event on a Redis pub/sub channel (`ws:events`). Each instance subscribes to that channel and delivers events published by *other* instances to its own sockets. Instances ignore their own broadcasts, so nothing is delivered twice, and local delivery still works if Redis pub/sub is unavailable.

The driver app (`DriverView`) receives matches over WebSocket. The rider app currently polls for nearby drivers; the server also emits `driver_location` pushes to riders, but the rider UI doesn't consume them yet.

## Key engineering decisions

See [docs/ADR.md](./docs/ADR.md) for the full write-up, including two real bugs found through deliberate failure testing.

- **Redis Geo instead of SQL spatial queries.** Driver positions are hot, short-lived data and the only query needed is "nearest N within a radius", which `GEOSEARCH` does in memory.
- **Redlock for per-driver locking.** Locks expire automatically, so a crashed instance can't deadlock a driver. Note that with a single Redis node this behaves like a plain expiring lock; Redlock keeps the locking layer unchanged if Redis is later scaled out.
- **Failure ordering over distributed transactions.** The step most likely to fail (the MongoDB write) happens *before* the driver is removed from the geo pool, and anything that does fail afterwards is undone by a compensating rollback. The busy flag has a 30 minute TTL as a last-resort safety net.
- **Separate stores for separate concerns.** Redis for hot, ephemeral state (locations, locks, busy flags, demand). MongoDB for durable trip records.

## Verified results

- **Throughput:** about 3,061 req/s on nearest-driver search (autocannon, 50 connections, 10s, p50 latency 13ms). This is end-to-end HTTP latency, not raw Redis latency.
- **Concurrency safety:** 20 simultaneous ride requests for one driver result in exactly 1 success and 19 rejected (`__tests__/matching.test.js`).
- **Failure handling** (`__tests__/resilience.test.js`, needs only Redis):
  - a MongoDB failure leaves the driver available and searchable;
  - a failure after the trip is created cancels the trip and restores the driver;
  - the busy flag always carries a TTL;
  - events published by another instance reach a locally connected WebSocket client.

## Observability

Each backend instance exposes Prometheus metrics at `/metrics`: default process metrics, `http_request_duration_seconds`, `ride_requests_total{outcome="success|failed|infra_error"}`, and `ride_matching_lock_contention_total`. Docker Compose starts Prometheus (`:9090`) and Grafana (`:3001`, login `admin` / `admin`, local use only). Prometheus is configured to scrape the backend on port 4000.

## Tech stack

- **Backend:** Node.js, Express, `ws`
- **Data:** Redis (Geo, Redlock, pub/sub), MongoDB (Mongoose)
- **Frontend:** React, Vite, Leaflet (OpenStreetMap)
- **Infra:** Docker Compose, nginx (load balancer), Prometheus, Grafana
- **Testing / CI:** Jest, GitHub Actions (Redis and MongoDB service containers, Node 20)

## Running locally

Docker Compose starts five services: Redis (6379), MongoDB (host port 27018), nginx (8080), Prometheus (9090) and Grafana (3001).

```bash
# 1. Infrastructure
docker compose up -d

# 2. Backend (set MONGO_URI in backend/.env, or rely on the default
#    mongodb://localhost:27018/ridematching)
cd backend
npm install
npm run dev            # http://localhost:4000

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173

# 4. Optional: simulate moving drivers (separate terminal)
cd backend
node simulate-drivers.js
```

**Tests:** `cd backend && npm test` (needs Redis on `localhost:6379` and a reachable MongoDB; set `MONGO_URI` to a throwaway database).

**Multi-instance setup:** nginx on port 8080 balances between backend instances on ports 4000 and 4001 and forwards WebSocket upgrades. Start two instances to try it:

```bash
PORT=4000 npm run dev     # terminal 1
PORT=4001 npm run dev     # terminal 2
curl localhost:8080/metrics
```

(On Windows PowerShell: `$env:PORT=4000; npm run dev`.)

## Known limitations

- **The frontend points at the deployed backend.** The API and WebSocket URLs in `App.jsx` and `DriverView.jsx` are hardcoded to the hosted Render service, so running the frontend locally does not talk to your local backend until you change them.
- **Pub/sub delivery is fire-and-forget.** An event published while a subscriber is reconnecting is lost. Redis Streams would give at-least-once delivery.
- **Single Redis node.** Redlock is most meaningful with several independent nodes.
- **Surge calculation scans the demand set** and checks each rider's TTL key one at a time. Pipelining, or a sorted set scored by timestamp, would make it cheaper.
- **Lock contention is logged as an infrastructure error.** Redlock reports a lost lock race and an unreachable Redis with the same error, so contention losers show up in the `infra_error` counter.
- **Prometheus scrapes only the instance on port 4000.**

## Future improvements

- Move the API base URL into an environment variable (`VITE_API_URL`) and show surge pricing and live driver pushes in the rider UI
- Distributed tracing (OpenTelemetry) across the request lifecycle
- Automated chaos tests (kill Redis or MongoDB mid-traffic) in CI; this was done manually to find the bugs in the ADR
- At-least-once WebSocket delivery with Redis Streams