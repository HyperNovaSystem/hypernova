# Appendix C: Target Performance Budgets

| Metric | Target |
|---|---|
| Core bundle (gzipped) | < 20 KB |
| Full engine (all packages, gzipped) | < 180 KB |
| 10,000 sprites @ 60 FPS | ✓ desktop, ✓ mobile |
| 100,000 particles @ 60 FPS | ✓ WebGPU, degraded WebGL2 |
| Fixed update jitter | < 1 ms variance |
| Heap allocations (steady state) | 0 per frame |
| Scheduler graph build (per stage) | < 0.1 ms |
| Scheduler batch execution overhead | < 0.01 ms per batch |
| Spatial index query (1000 entities) | < 0.1 ms |
| Input latency (keypress → render) | < 2 frames |
| Scene load (100 entities) | < 50 ms |
| Scene hot-reload (diff + patch) | < 16 ms (within 1 frame) |
| Dev server cold start | < 500 ms |
| HMR system swap | < 100 ms |
| Editor round-trip (UI edit → disk → HMR) | < 200 ms |
| Worker pool startup | < 50 ms |
| Task round-trip (Transferable) | < 1 ms overhead |
| Task round-trip (structured clone) | < 5 ms overhead |
