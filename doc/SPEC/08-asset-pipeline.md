# 8. Async Asset Pipeline

## Loading Lifecycle

```
Define Manifest → Fetch → Decode → Process → Cache → Ready
                    │        │         │
                    │        │         └─ Atlas packing, mipmap gen
                    │        └─ Image decode, audio decode, JSON parse
                    └─ HTTP fetch with progress tracking
```

## Progressive Loading

Games can define **load priorities** and start rendering before all assets are ready:

```typescript
const manifest = defineManifest({
  // Priority 0: loaded before anything renders
  critical: {
    ui_atlas: 'assets/ui.webp',
    font: 'assets/font.fnt',
  },
  // Priority 1: loaded during splash screen
  gameplay: {
    player: 'assets/player.png',
    enemies: 'assets/enemies.png',
  },
  // Priority 2: streamed in the background during gameplay
  ambient: {
    bgm: { src: 'assets/music.ogg', stream: true },
    particles: 'assets/particles.png',
  },
});
```

## Dev Mode Hot Reload

In development, the asset pipeline watches source files and hot-reloads changed assets without restarting the game.
A texture change appears on screen within milliseconds.
Tilemap edits in Tiled or LDtk are reflected live.
