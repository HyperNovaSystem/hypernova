# 9. Networking Primitives

## Architecture Patterns Supported

HyperNova doesn't impose a networking architecture.
Instead, it provides primitives that support common patterns:

**Authoritative Server (Client-Server)**
- Server runs the ECS world as the source of truth (headless mode, no renderer).
- Clients send inputs, receive state snapshots.
- `@nova/net` provides snapshot serialization, delta compression, and interpolation.

**Rollback Netcode (Peer-to-Peer)**
- Each peer runs a local simulation.
- Inputs are exchanged and applied retroactively.
- `@nova/net` provides world state save/restore, input buffer management, and resimulation helpers.
- Rapier's determinism + seeded PRNG (`Random` resource) makes rollback reliable.

## Snapshot Serialization

v1 uses JSON for snapshot serialization (simple, debuggable). A custom binary format with delta compression and quantization is a v2 optimization — the SoA layout makes this a natural evolution (typed arrays are already contiguous, serialization is close to memcpy), but should be informed by profiling of the JSON path first.

```typescript
import { WorldSerializer } from '@nova/net';

const serializer = new WorldSerializer(world, {
  // Only sync these components over the network
  components: [Position, Velocity, Health, SpriteIndex],
});

const snapshot = serializer.serialize();     // Uint8Array (JSON-encoded in v1)
serializer.deserialize(snapshot);            // apply to world
const delta = serializer.serializeDelta(previousSnapshot); // only changed data
```

## Clock Synchronization

```typescript
import { ClockSync } from '@nova/net';

const clock = new ClockSync(transport);
await clock.sync(); // exchanges timestamps, calculates offset and RTT

const serverTime = clock.now();       // estimated server time
const rtt = clock.roundTripTime;      // smoothed RTT
const jitter = clock.jitter;          // RTT variance
```
