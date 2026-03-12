/**
 * HyperNova ECS — LN2 Pump Simulation
 *
 * Demonstrates the HyperNova ECS engine used for industrial simulation:
 * - Component definitions (SoA storage for Tank, Pump, Valve)
 * - Systems (ValveDynamics, TankThermo, PumpDynamics, Safety)
 * - Headless tick API for deterministic stepping
 * - Canvas rendering reading directly from component arrays
 */

import { Engine } from '@nova/core';
import {
  Tank, Pump, Valve, PipeConnection,
  SupplyTankTag, ReceiverTankTag,
  SupplyValveTag, DischargeValveTag, VentValveTag,
  PumpMode,
} from './components.js';
import {
  ValveDynamicsSystem, TankThermoSystem, PumpDynamicsSystem, SafetySystem,
} from './systems.js';
import { renderFrame, updateInfoPanel } from './renderer.js';

// ─── Engine Setup ───

const engine = new Engine({
  headless: true,
  fixedTimestep: 1 / 60,
  seed: 42,
  maxEntities: 100,
});

// Register components
engine.registerComponent(Tank);
engine.registerComponent(Pump);
engine.registerComponent(Valve);
engine.registerComponent(PipeConnection);
engine.registerComponent(SupplyTankTag);
engine.registerComponent(ReceiverTankTag);
engine.registerComponent(SupplyValveTag);
engine.registerComponent(DischargeValveTag);
engine.registerComponent(VentValveTag);

// Add systems in order
engine.addStage('physics', [
  ValveDynamicsSystem,
  TankThermoSystem,
  PumpDynamicsSystem,
  SafetySystem,
], { sequential: true });

// ─── Spawn Entities ───

const world = engine.world;

// Supply tank
const supplyTank = world.spawn();
world.addComponent(supplyTank, Tank, {
  liquidVolume: 4250, capacity: 5000, temperatureK: 77.36,
  pressureKpaG: 0, heatLeakW: 25,
});
world.addComponent(supplyTank, SupplyTankTag);

// Receiver tank
const receiverTank = world.spawn();
world.addComponent(receiverTank, Tank, {
  liquidVolume: 200, capacity: 2000, temperatureK: 77.36,
  pressureKpaG: 0, heatLeakW: 15,
});
world.addComponent(receiverTank, ReceiverTankTag);

// Supply valve V-101
const supplyValve = world.spawn();
world.addComponent(supplyValve, Valve, {
  positionSetpoint: 0, actualPosition: 0, cvFull: 50, strokeTime: 5,
});
world.addComponent(supplyValve, SupplyValveTag);

// Discharge valve V-102
const dischargeValve = world.spawn();
world.addComponent(dischargeValve, Valve, {
  positionSetpoint: 0, actualPosition: 0, cvFull: 40, strokeTime: 5,
});
world.addComponent(dischargeValve, DischargeValveTag);

// Vent valve V-103
const ventValve = world.spawn();
world.addComponent(ventValve, Valve, {
  positionSetpoint: 0, actualPosition: 0, cvFull: 20, strokeTime: 3,
});
world.addComponent(ventValve, VentValveTag);

// Pump P-101
const pump = world.spawn();
world.addComponent(pump, Pump, {
  mode: PumpMode.OFF, speedSetpoint: 75, actualSpeed: 0,
  flowRate: 0, dischargePressureKpaG: 0, powerKW: 0,
  ratedFlow: 80, ratedHead: 350, cavitating: 0, runtime: 0,
});
world.addComponent(pump, PipeConnection, {
  sourceTank: supplyTank, destTank: receiverTank,
  supplyValve: supplyValve, dischargeValve: dischargeValve,
});

// ─── Render entities reference ───

const entities = { supplyTank, receiverTank, pump, supplyValve, dischargeValve, ventValve };

// ─── DOM ───

const $canvas = document.getElementById('canvas') as HTMLCanvasElement;
const $info = document.getElementById('info')!;
const $tickCount = document.getElementById('tick-count')!;
const $btnToggle = document.getElementById('btn-toggle')!;
const $btnStep = document.getElementById('btn-step')!;
const $btnPump = document.getElementById('btn-pump')!;
const $btnValves = document.getElementById('btn-valve-open')!;
const $btnReset = document.getElementById('btn-reset')!;

let running = false;
let tickCount = 0;

function doTick(): void {
  engine.tick();
  tickCount++;
  $tickCount.textContent = `Tick: ${tickCount}`;
}

function render(): void {
  renderFrame($canvas, entities, tickCount);
  updateInfoPanel($info, entities);
}

// ─── Controls ───

$btnToggle.addEventListener('click', () => {
  running = !running;
  $btnToggle.textContent = running ? 'Pause' : 'Start';
  $btnToggle.classList.toggle('active', running);
});

$btnStep.addEventListener('click', () => {
  doTick();
  render();
});

$btnPump.addEventListener('click', () => {
  const mode = Pump.mode[pump];
  if (mode === PumpMode.OFF || mode === PumpMode.FAULT) {
    Pump.mode[pump] = PumpMode.STARTING;
    Pump.runtime[pump] = 0;
    Pump.cavitating[pump] = 0;
    $btnPump.textContent = 'Stop Pump';
  } else {
    Pump.mode[pump] = PumpMode.STOPPING;
    $btnPump.textContent = 'Start Pump';
  }
});

$btnValves.addEventListener('click', () => {
  const isOpen = Valve.positionSetpoint[supplyValve] > 50;
  const target = isOpen ? 0 : 100;
  Valve.positionSetpoint[supplyValve] = target;
  Valve.positionSetpoint[dischargeValve] = target;
  $btnValves.textContent = isOpen ? 'Open Valves' : 'Close Valves';
});

$btnReset.addEventListener('click', () => {
  running = false;
  tickCount = 0;
  $btnToggle.textContent = 'Start';
  $btnToggle.classList.remove('active');
  $btnPump.textContent = 'Start Pump';
  $btnValves.textContent = 'Open Valves';

  // Reset component data
  Tank.liquidVolume[supplyTank] = 4250;
  Tank.pressureKpaG[supplyTank] = 0;
  Tank.temperatureK[supplyTank] = 77.36;
  Tank.liquidVolume[receiverTank] = 200;
  Tank.pressureKpaG[receiverTank] = 0;
  Tank.temperatureK[receiverTank] = 77.36;

  Pump.mode[pump] = PumpMode.OFF;
  Pump.actualSpeed[pump] = 0;
  Pump.flowRate[pump] = 0;
  Pump.runtime[pump] = 0;
  Pump.cavitating[pump] = 0;

  Valve.positionSetpoint[supplyValve] = 0;
  Valve.actualPosition[supplyValve] = 0;
  Valve.positionSetpoint[dischargeValve] = 0;
  Valve.actualPosition[dischargeValve] = 0;
  Valve.positionSetpoint[ventValve] = 0;
  Valve.actualPosition[ventValve] = 0;

  render();
});

// ─── Main Loop ───

function loop(): void {
  if (running) {
    // Run 4 ticks per frame for visible speed (at 60fps = 240 sim Hz)
    for (let i = 0; i < 4; i++) doTick();
  }
  render();
  requestAnimationFrame(loop);
}

render();
requestAnimationFrame(loop);
