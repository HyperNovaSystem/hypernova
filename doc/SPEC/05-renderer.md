# 5. Renderer — WebGPU First (Optional)

The renderer is an optional plugin. HyperNova simulations run headless without it. When installed, the renderer reads ECS components and draws to a canvas.

## Why WebGPU

WebGPU provides compute shaders, better draw call performance, explicit resource management, and a modern API that maps well to Vulkan/Metal/D3D12.

Key wins for a simulation engine:
- **Compute shaders** for GPU-side simulation (boids, fluid dynamics, spatial hashing), particle systems, pathfinding offload, and procedural generation.
- **Reduced driver overhead** — fewer draw calls matter less, but batching is still free performance.
- **Storage buffers** — pass arbitrary data to shaders without texture encoding hacks.

## Fallback Strategy

The renderer provides a WebGL2 backend with the same rendering API surface.
Feature detection at startup selects the best available backend.
Compute-dependent features (GPU particles, GPU spatial hash, custom compute passes) gracefully degrade to CPU implementations on WebGL2.

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

## Compute Pipeline

For GPU-accelerated simulation, the renderer exposes a compute shader API:

```typescript
import { defineCompute } from '@nova/renderer-webgpu';

const BoidCompute = defineCompute({
  shader: `
    struct Boid { pos: vec2f, vel: vec2f }

    @group(0) @binding(0) var<storage, read> boids_in: array<Boid>;
    @group(0) @binding(1) var<storage, read_write> boids_out: array<Boid>;

    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) id: vec3u) {
      let i = id.x;
      // ... flocking logic ...
      boids_out[i] = updated;
    }
  `,
  buffers: {
    boids_in: 'storage',
    boids_out: 'storage',
  },
  dispatch: (count: number) => [Math.ceil(count / 256), 1, 1],
});

// In a system:
const renderer = resources.get(RendererState);
renderer.dispatch(BoidCompute, { boids_in: bufA, boids_out: bufB });
renderer.readback(bufB, cpuArray);  // async GPU→CPU transfer
```

On WebGL2, compute-dependent systems fall back to CPU implementations. The engine emits a `ComputeFallback` diagnostic at startup when this happens.

## GPUDevice Access

Advanced users can access the underlying `GPUDevice` for custom render or compute passes that go beyond the `defineCompute` / `defineMaterial` APIs:

```typescript
const renderer = resources.get(RendererState);
const device = renderer.device;    // GPUDevice | null (null on WebGL2 or headless)
const queue = renderer.queue;      // GPUQueue | null
```

This is an escape hatch — not the primary API. Code using raw `GPUDevice` is not portable to the WebGL2 fallback.
