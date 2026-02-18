# 10.5 Native Module Bridge (`@nova/native`) — Future

> **Scope note:** `@nova/native` is deferred to Phase 4+. This section captures the design intent for when native module access is needed. The core engine and web target do not depend on it.

## Overview

`@nova/native` provides a typed bridge between browser-side simulation code and native Node.js / Electron modules (serial ports, GPIO, USB HID, filesystem, native windows). The transport layer depends on the deployment target:

| Target | Transport | Notes |
|--------|-----------|-------|
| **Electron** | Electron IPC (`contextBridge`) | Fastest — direct process communication, no network |
| **Local (.exe)** | WebSocket to embedded Node.js server | Same-machine localhost, ~0.1ms latency |
| **Web** | Graceful degradation | `NativeBridge.available` is `false`, calls return immediately-rejected tickets |

## Design Sketch

- **Server / Main Process:** `defineNativeService({ name, init, methods, dispose })` — async methods callable from simulation code, `emit()` for streaming data to renderer process
- **Client:** `defineNativeClient<T>({ name })` — typed proxy, calls return `NativeTicket` (not Promise), results arrive via `NativeResult` / `NativeStream` events
- **ECS integration:** `NativeSyncSystem` drains results in a `native-sync` stage (after `worker-sync`), same pattern as `@nova/workers`
- **Wire protocol:** JSON text frames for control, binary frames with 4-byte header for high-frequency data
- **Electron optimization:** When running in Electron, the bridge uses `ipcRenderer.invoke()` / `ipcMain.handle()` instead of WebSocket — no serialization overhead for structured-cloneable data

Full design details will be specified when this feature enters active development.
