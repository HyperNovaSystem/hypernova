# 5. Renderer — WebGPU First

## Why WebGPU

WebGPU provides compute shaders, better draw call performance, explicit resource management, and a modern API that maps well to Vulkan/Metal/D3D12.

For a 2D engine, the key wins are:
- **Compute shaders** for particle simulation, GPU-side spatial hashing, pathfinding offload, and procedural generation.
- **Reduced driver overhead** — fewer draw calls matter less, but batching is still free performance.
- **Storage buffers** — pass arbitrary data to shaders without texture encoding hacks.

## Fallback Strategy

WebGPU availability (as of 2025) is strong on Chrome and Edge, growing on Firefox and Safari.
The renderer provides a WebGL2 backend with the same API surface.
Feature detection at startup selects the best available backend.
Compute-dependent features (GPU particles, GPU spatial hash) gracefully degrade to CPU implementations on WebGL2.

## Render Pipeline

```
1. Cull         — Frustum cull against camera AABB
2. Sort         — Sort by layer → texture → blend mode → depth
3. Batch        — Merge consecutive compatible sprites into batches
4. Upload       — Stream vertex/instance data to GPU buffers
5. Draw         — Issue batched draw calls
6. Post-process — Bloom, color grading, CRT shader, etc. (optional)
7. Present      — Composite to canvas
```

## Custom Materials

Users can define custom materials for special rendering effects:

```typescript
const waterMaterial = defineMaterial({
  shader: `
    @fragment
    fn main(@location(0) uv: vec2f, @builtin(position) pos: vec4f) -> @location(0) vec4f {
      let time = uniforms.elapsed;
      let distortion = sin(uv.y * 20.0 + time * 3.0) * 0.01;
      return textureSample(tex, samp, uv + vec2f(distortion, 0.0));
    }
  `,
  uniforms: {
    elapsed: Types.f32,
  },
});
```
