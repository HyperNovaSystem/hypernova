# 10.5 Native Module Bridge (`@nova/native`) — Future

> **Scope note:** `@nova/native` is deferred to Phase 4+. This section captures the design intent for when native module access is needed. The core engine and web target do not depend on it.

## Overview

The local exe target (see [Packaging & Distribution](./18-packaging.md)) runs a Node.js server process. `@nova/native` provides a typed WebSocket bridge between browser game code and native Node.js modules (serial ports, GPIO, USB HID, filesystem) running in the server process. On the web target it degrades gracefully — `NativeBridge.available` is `false` and calls return immediately-rejected tickets.

## Design Sketch

- **Server:** `defineNativeService({ name, init, methods, dispose })` — async methods callable from game code, `emit()` for streaming data to browser
- **Client:** `defineNativeClient<T>({ name })` — typed proxy, calls return `NativeTicket` (not Promise), results arrive via `NativeResult` / `NativeStream` events
- **ECS integration:** `NativeSyncSystem` drains results in a `native-sync` stage (after `worker-sync`), same pattern as `@nova/workers`
- **Wire protocol:** JSON text frames for control, binary frames with 4-byte header for high-frequency data
- **Graceful degradation:** On web target, `NativeBridge.available` is `false`, calls return immediately-rejected tickets

Full design details will be specified when this feature enters active development.
