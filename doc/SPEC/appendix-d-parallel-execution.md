# Appendix D: Future — Parallel System Execution

Parallel execution of independent ECS system batches across Web Workers was evaluated during the design phase and **deferred** due to three critical barriers:

1. **`Atomics.wait()` is prohibited on the main browser thread.** The natural barrier mechanism (main thread blocks until workers complete a batch) throws `TypeError` in all browsers. The only non-blocking alternative — `Atomics.waitAsync()` — turns frame execution into an async chain that breaks the single-rAF-callback guarantee and adds 0.1–0.5ms latency per barrier, exceeding the overhead of the work being parallelized.

2. **Module scope isolation.** System `execute` functions reference module-level component variables (`Position.x[eid]`). Web Workers run in separate JavaScript contexts with independent module instances. Resolving component references across thread boundaries requires a non-trivial runtime registration system that no existing TypeScript ECS has successfully shipped.

3. **Resources are JavaScript objects.** `SharedArrayBuffer` only holds flat numeric data. Resources containing `Map`, `Set`, or class instances cannot be shared across workers. Any system that reads or writes a resource — the majority of non-trivial systems — is pinned to the main thread.

**Performance reality:** For parallelism to break even (4 workers, ~0.3ms realistic dispatch+barrier overhead), each batch must do >0.4ms of sequential work. A movement system on 1000 entities takes ~0.03ms. Typical 2D games lack sufficient per-batch workload.

**Viable future path: Scheduler-on-Worker.** If parallelism is revisited, the most promising architecture is running the entire ECS tick on a dedicated scheduler worker (which CAN use `Atomics.wait()`), with the main thread serving as a thin render client. This avoids the main-thread blocking prohibition entirely and simplifies resource sharing since all ECS state lives in worker scope. This would be a significant architectural change that should only be pursued once the sequential engine is proven and profiling reveals a genuine CPU bottleneck in system execution.

The current architecture preserves the option: dependency-graph batching is already computed, SoA component storage is cache-friendly, and the arena allocator can be backed by `SharedArrayBuffer` when needed. Game code does not change — only the scheduler's execution strategy would.

---

*HyperNova* is a working title.
This spec is a living document and will evolve as implementation reveals constraints and opportunities.
