# 16. Packaging & Distribution

HyperNova simulations are browser-first, but distribution needs vary. The `nova export` command provides three targets that all consume the same Vite production build:

```
nova build (Vite production)
     │
     ▼
  dist/  (static HTML/JS/CSS/WASM/assets)
     │
     ├──▶  --target web        → deploy-ready static bundle
     ├──▶  --target electron   → desktop app with native integration
     └──▶  --target local      → standalone .exe with embedded server + native bridge
```

## 16.1 Web Target (Default)

`nova export --target web` produces a self-contained static directory for deployment to any HTTP server or hosting platform.

**Output:**
```
dist/
  index.html
  assets/
    main-[hash].js          # tree-shaken, minified
    main-[hash].css
    rapier_bg-[hash].wasm   # if @nova/physics-rapier used
    images/
    audio/
  manifest.json             # asset manifest for preloading
  _headers                  # Netlify header config
  .htaccess                 # Apache header config
```

**Hosting requirements:**
- HTTPS (required for WebGPU — all major hosting platforms provide this)
- `.wasm` served with `Content-Type: application/wasm`
- For `SharedArrayBuffer` support (`@nova/workers`), the server must send:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`

The export generates `_headers` (Netlify format) and `.htaccess` (Apache) with the correct COOP/COEP headers. Nginx and Caddy snippets are printed to the console.

**PWA mode** (`nova export --target web --pwa`):
- Generates `manifest.webmanifest` with app name, icons, `display: fullscreen`, theme color
- Generates a service worker that precaches all assets from the manifest
- App becomes installable via browser's "Install App" prompt
- Fully offline-capable after first visit

**itch.io mode** (`nova export --target web --zip`):
- Produces a `.zip` with `index.html` at root (itch.io requirement)
- All asset paths relative

## 16.2 Electron Target (Desktop App)

`nova export --target electron` produces a native desktop application using Electron. This is the recommended target for simulation tools, editors, dashboards, and any application that needs native OS integration.

**Capabilities beyond web:**

| Feature | Details |
|---------|---------|
| Native window chrome | Frameless window, custom titlebar, always-on-top |
| System tray | Minimize to tray, tray menu, notifications |
| File system | `dialog.showOpenDialog()`, direct file read/write |
| Multi-window | Separate windows for devtools, parameter panels, data views |
| Native menus | OS menu bar with keyboard shortcuts |
| Auto-update | `electron-updater` for automatic update delivery |
| GPU context | Chromium's GPU stack — WebGPU without browser restrictions |
| Offline | Built-in — no server required |

**Architecture:**
```
┌────────────────────────────┐
│  Electron Main Process     │
│  - Window management       │
│  - @nova/native services   │
│  - File system access      │
│  - IPC message routing     │
└──────────────┬─────────────┘
               │ contextBridge / IPC
┌──────────────┴─────────────┐
│  Renderer Process          │
│  - HyperNova Engine        │
│  - Simulation + Rendering  │
│  - Devtools panel          │
└────────────────────────────┘
```

**`@nova/native` integration:** In Electron, the native bridge uses Electron IPC instead of WebSocket — faster, no localhost server required. `defineNativeService` methods run in the main process. `defineNativeClient` calls are routed via `contextBridge`.

**Preload script:** A generated preload script exposes a minimal, typed API via `contextBridge.exposeInMainWorld()`:
```typescript
// Automatically generated — no manual Electron boilerplate
window.nova = {
  native: { invoke, on, off },     // @nova/native IPC
  fs: { readFile, writeFile, ... }, // if @nova/persist uses filesystem
  dialog: { open, save },          // file dialogs
  app: { quit, setTitle },         // window management
};
```

**Build process:**
1. Run `nova build` (Vite production)
2. Generate Electron main process script (~200 lines)
3. Generate preload script with `contextBridge` bindings
4. Bundle with `electron-builder` or `electron-forge`
5. Produce platform-specific outputs (.dmg, .exe installer, .AppImage, .deb)

**Output:**
```
release/
  MySimulation.dmg         # macOS
  MySimulation-Setup.exe   # Windows installer
  MySimulation.AppImage    # Linux
```

**Binary size:** ~80–120 MB (Electron runtime + Chromium + game assets). Compressed: ~40–60 MB.

## 16.3 Local Server Target (Standalone Executable)

`nova export --target local` produces a single executable that embeds the simulation files and a minimal HTTP server. On launch it serves the simulation on localhost and opens the user's default browser. This is a lighter alternative to Electron when native OS integration is not needed.

**Technology:** Node.js Single Executable Application (SEA), built into Node.js 20+. The entire dist directory and a ~240-line server (HTTP + WebSocket) are embedded into the Node.js binary via `sea.getRawAsset()`.

**Runtime behavior:**
1. Probe for a free port starting at 7700 (sequential scan, `127.0.0.1` only)
2. Start `node:http` serving embedded assets with correct MIME types and COOP/COEP headers
3. Initialize the `@nova/native` service registry and load configured native services
4. Listen for WebSocket upgrade on `/__nova` for the native module bridge
5. Open the default browser to `http://127.0.0.1:{port}`
6. Console displays: `Simulation running at http://127.0.0.1:7700 — press Ctrl+C to quit`
7. Graceful shutdown on `SIGINT`/`SIGTERM` (calls `dispose()` on all native services)

**Embedded server details:**
- Raw `node:http` + `ws` (pure JS WebSocket library, ~25 KB, no native dependencies)
- MIME type map covers `.html`, `.js`, `.css`, `.wasm`, `.png`, `.jpg`, `.webp`, `.avif`, `.ogg`, `.mp3`, `.wav`, `.json`
- `.wasm` → `application/wasm` (required for `WebAssembly.instantiateStreaming`)
- COOP/COEP headers on all responses (enables `SharedArrayBuffer`)
- SPA fallback: unknown routes serve `index.html`
- WebSocket on `/__nova`: native service bridge for `@nova/native` (see [Native Module Bridge](./12-native-bridge.md))

**Native module support:** When the simulation uses `@nova/native` services (see [Native Module Bridge](./12-native-bridge.md)), the server loads the configured service modules and routes WebSocket messages to them. Native Node.js addons (`.node` files compiled from C/C++) cannot be embedded in the SEA blob — they are shipped in an `addons/` directory alongside the executable. The server resolves native module `require()` calls relative to the executable's directory.

**WebGPU:** `127.0.0.1` is a secure context in all browsers — WebGPU works without HTTPS.

**Build process:**
1. Run `nova build` (Vite production)
2. Bundle server script to single CJS file via esbuild (native addon requires marked as external)
3. Collect native addon `.node` files into `addons/` (via `prebuild-install` for prebuilt binaries, `node-gyp` fallback)
4. Rewrite native module require paths to resolve relative to the executable
5. Generate SEA config (enumerate all files in `dist/`, map to asset keys)
6. Run `node --build-sea` to produce the executable
7. (Optional) `rcedit` to set custom icon on Windows

**Output:**
```
release/
  mysimulation.exe         # SEA binary (simulation + server embedded)
  addons/                  # native addon files (only if @nova/native used)
    serialport.node
    other-binding.node
```

**Binary size:** ~50–75 MB (Node.js binary ~50 MB + simulation assets). Compressed: ~25–40 MB. Native addons add their own size (typically 1–5 MB each).

## 16.4 Export Configuration

```typescript
// nova.config.ts
export default {
  name: 'My Simulation',
  width: 800,
  height: 600,
  icon: './assets/icon.png',

  export: {
    web: {
      pwa: false,        // generate service worker + manifest
      zip: false,        // produce itch.io zip
    },
    electron: {
      frameless: false,   // frameless window (custom titlebar)
      tray: false,        // system tray support
      autoUpdate: false,  // electron-updater integration
    },
    local: {
      port: 7700,        // preferred starting port
      openBrowser: true,  // auto-open browser on launch
      native: {          // @nova/native service configuration (optional)
        services: ['./services/serial.service'],
      },
    },
  },
};
```

**CLI flags:**
```bash
nova export --target <web|electron|local>
            --out ./release          # output directory
            --name "My Simulation"   # executable/app name
            --icon ./icon.png        # app icon
            --pwa                    # web only: enable PWA
            --zip                    # web only: produce zip
            --platform <win32|darwin|linux>  # electron/local: target OS
```

## 16.5 Vite Plugin Requirements

For all export targets to work correctly, `@nova/vite-plugin` must:
- Set `base: './'` (relative paths) in production builds — relative paths are required for the local target's embedded server and Electron's file:// protocol
- Emit a WASM loader that falls back to `WebAssembly.instantiate(arrayBuffer)` when `instantiateStreaming` fails (handles missing MIME type gracefully)

## 16.6 Comparison

| Dimension | Web | Electron | Local (.exe) |
|---|---|---|---|
| Output size | Game only | ~80–120 MB | ~50–75 MB |
| Distribution | URL | Installer / DMG | Download .exe + addons/ |
| WebGPU guaranteed | No | Yes (Chromium) | No (user's browser) |
| Offline | PWA mode | Yes | Yes |
| Native APIs | None | Full (via IPC) | Via `@nova/native` WS bridge |
| File dialogs | No | Yes | No |
| System tray | No | Yes | No |
| Multi-window | No | Yes | No |
| Auto-update | Redeploy | electron-updater | Manual |
| Mobile | Yes | No | No |
| Build deps | None | electron-builder | None |
| Save to disk | IndexedDB | Filesystem (IPC) | Via `@nova/native` service |
