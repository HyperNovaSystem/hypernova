import { World } from './world.js';
import { Random, RandomResource } from './random.js';
import { defineResource } from './resource.js';
import type {
  EngineConfig, Plugin, AppBuilder, SystemDef, StageOptions,
  ComponentDef, ComponentSchema, ResourceToken,
} from './types.js';

/** Time resource — always available */
export interface TimeData {
  /** Fixed timestep delta (seconds) — never changes */
  readonly dt: number;
  /** Total simulation time (sum of all dt) */
  elapsed: number;
  /** Simulation tick count */
  frame: number;
  /** Current time scale (0 = paused) */
  timeScale: number;
  /** Real wall-clock time since engine.start() */
  wallTime: number;
}

export const Time = defineResource<TimeData>('Time');

/**
 * The HyperNova Engine.
 *
 * Manages the simulation loop with fixed timestep, time control,
 * headless mode, and plugin system.
 */
export class Engine implements AppBuilder {
  readonly world: World;
  readonly config: Required<EngineConfig>;

  private accumulator: number = 0;
  private lastWallTime: number = 0;
  private running: boolean = false;
  private rafId: number = 0;
  private plugins: Plugin[] = [];
  private cleanupFns: (() => void)[] = [];

  constructor(config: EngineConfig = {}) {
    this.config = {
      maxEntities: config.maxEntities ?? 50_000,
      fixedTimestep: config.fixedTimestep ?? 1 / 60,
      maxSubstepsPerFrame: config.maxSubstepsPerFrame ?? 4,
      headless: config.headless ?? false,
      seed: config.seed ?? Date.now(),
      timeScale: config.timeScale ?? 1,
    };

    this.world = new World(this.config.maxEntities);

    // Initialize core resources
    const timeData: TimeData = {
      dt: this.config.fixedTimestep,
      elapsed: 0,
      frame: 0,
      timeScale: this.config.timeScale,
      wallTime: 0,
    };
    this.world.insertResource(Time, timeData);

    const rng = new Random(this.config.seed);
    this.world.insertResource(RandomResource, rng);
  }

  // ─── AppBuilder Implementation ───

  registerComponent(comp: ComponentDef): void {
    this.world.registerComponent(comp);
  }

  addStage(name: string, systems: SystemDef[], options?: StageOptions): void {
    this.world.addStage(name, systems, options);
  }

  addSystem(stage: string, system: SystemDef): void {
    this.world.addSystem(stage, system);
  }

  insertResource<T>(token: ResourceToken<T>, value: T): void {
    this.world.insertResource(token, value);
  }

  addPlugin(plugin: Plugin): void {
    // Check for duplicates
    if (this.plugins.some(p => p.name === plugin.name)) return;

    // Check dependencies
    if (plugin.depends) {
      for (const dep of plugin.depends) {
        if (!this.plugins.some(p => p.name === dep)) {
          throw new Error(`Plugin "${plugin.name}" depends on "${dep}" which is not installed`);
        }
      }
    }

    this.plugins.push(plugin);
    const cleanup = plugin.install(this);
    if (cleanup) {
      this.cleanupFns.push(cleanup);
    }
  }

  // ─── Time Control ───

  setTimeScale(scale: number): void {
    const time = this.world.getResource(Time);
    (time as { timeScale: number }).timeScale = scale;
  }

  getTimeScale(): number {
    return this.world.getResource(Time).timeScale;
  }

  // ─── Headless Tick API ───

  /**
   * Advance exactly one fixed step synchronously.
   */
  tick(): void {
    const time = this.world.getResource(Time);
    this.world.tick(time.dt);
    (time as { elapsed: number }).elapsed += time.dt;
    (time as { frame: number }).frame++;
  }

  /**
   * Advance N fixed steps synchronously.
   */
  tickN(n: number): void {
    for (let i = 0; i < n; i++) {
      this.tick();
    }
  }

  /**
   * Advance until predicate returns true.
   */
  tickUntil(predicate: () => boolean, maxTicks: number = 100_000): void {
    for (let i = 0; i < maxTicks; i++) {
      if (predicate()) return;
      this.tick();
    }
  }

  /**
   * Step exactly one frame (works at any timeScale, including 0).
   * Useful for debugging — advances one simulation tick.
   */
  step(): void {
    this.tick();
  }

  // ─── Browser Loop ───

  /**
   * Start the simulation loop.
   * In headless mode, does nothing (use tick()/tickN()/tickUntil() instead).
   * In browser mode, starts a requestAnimationFrame loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastWallTime = performance.now() / 1000;

    if (!this.config.headless) {
      this.rafLoop();
    }
  }

  /**
   * Stop the simulation loop.
   */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private rafLoop = (): void => {
    if (!this.running) return;

    const now = performance.now() / 1000;
    const wallDt = now - this.lastWallTime;
    this.lastWallTime = now;

    const time = this.world.getResource(Time);
    (time as { wallTime: number }).wallTime += wallDt;

    // Accumulate scaled time
    this.accumulator += wallDt * time.timeScale;

    // Cap accumulator to prevent death spiral
    const maxAccum = this.config.maxSubstepsPerFrame * this.config.fixedTimestep;
    if (this.accumulator > maxAccum) {
      this.accumulator = maxAccum;
    }

    // Run fixed steps
    while (this.accumulator >= this.config.fixedTimestep) {
      this.world.tick(this.config.fixedTimestep);
      (time as { elapsed: number }).elapsed += this.config.fixedTimestep;
      (time as { frame: number }).frame++;
      this.accumulator -= this.config.fixedTimestep;
    }

    this.rafId = requestAnimationFrame(this.rafLoop);
  };

  /**
   * Compute interpolation alpha for smooth rendering.
   * Returns a value in [0, 1) representing how far we are
   * between the previous and current simulation state.
   */
  getInterpolationAlpha(): number {
    return this.accumulator / this.config.fixedTimestep;
  }

  // ─── Cleanup ───

  dispose(): void {
    this.stop();
    // Run cleanups in reverse order
    for (let i = this.cleanupFns.length - 1; i >= 0; i--) {
      this.cleanupFns[i]();
    }
    this.cleanupFns.length = 0;
    this.plugins.length = 0;
  }
}
