# Distributed Ride Matching Engine

![CI](https://github.com/zenabkabir9829/distributed-ride-matching/actions/workflows/ci.yml/badge.svg)
A real-time ride-hailing dispatch system demonstrating distributed-systems concepts: geospatial indexing, distributed locking, event-driven architecture, and real-time communication — inspired by Uber's dispatch system design.

## Live Demo
[View Live](https://distributed-ride-matching-six.vercel.app/)

## Architecture
**Flow:**
1. Drivers continuously report location via `POST /driver/:id/location`, stored in Redis using geospatial commands (`GEOADD`)
2. Riders search nearby drivers via `GEOSEARCH` (radius query, sub-millisecond)
3. On ride request, a distributed lock (Redlock) ensures only one rider can claim a given driver, even under concurrent requests
4. Successful matches are persisted to MongoDB and pushed to the rider in real-time via WebSocket
5. Surge pricing dynamically adjusts based on live demand/supply ratio

## Key Engineering Decisions
See [docs/ADR.md](./docs/ADR.md) for detailed architecture decisions and two real bugs found via deliberate testing.
- **Redis Geospatial vs SQL spatial queries**: chosen for O(log N) radius search performance at scale
- **Redlock over simple SETNX**: provides safer distributed locking semantics with automatic expiry, preventing deadlocks if a service crashes mid-transaction
- **WebSockets over polling**: sub-second location updates without the overhead of constant HTTP polling
- **Database-per-concern**: Redis for hot, ephemeral state (locations, locks); MongoDB for durable trip records

## Verified Performance
- **~3,061 req/sec average** on geospatial nearest-driver search (autocannon, 50 concurrent connections, 10s test, p50 latency 13ms)
- **Concurrency-safety proven**: 20 simultaneous ride requests against the same driver correctly resulted in exactly 1 success and 19 safely blocked — zero race conditions

## Tech Stack
- **Backend**: Node.js, Express
- **Real-time**: WebSockets (`ws`)
- **Caching/Geo/Locking**: Redis (Geospatial commands, Redlock)
- **Database**: MongoDB (Mongoose)
- **Frontend**: React, Vite, Leaflet (OpenStreetMap)
- **Infra**: Docker Compose

## Running Locally

```bash
# Start Redis + MongoDB
docker compose up -d

# Backend
cd backend
npm install
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev

# Simulate driver movement (optional, separate terminal)
cd backend
node simulate-drivers.js
```

Backend runs on `http://localhost:4000`, frontend on `http://localhost:5173`.

## Future Improvements
- Distributed tracing (OpenTelemetry) across the request lifecycle
- Multi-instance horizontal scaling behind a load balancer
- Chaos testing (simulated node failures)
- Driver-side app view for two-sided real-time interaction