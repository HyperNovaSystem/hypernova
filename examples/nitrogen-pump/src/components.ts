/**
 * ECS Component definitions for the LN2 pumping system.
 *
 * Uses HyperNova's SoA (Struct of Arrays) component storage.
 * Each field is a typed array indexed by entity ID.
 */

import { defineComponent, Types } from '@nova/core';

// ─── Tank Component ───
// Models a cryogenic storage vessel
export const Tank = defineComponent('Tank', {
  /** Liquid volume (liters) */
  liquidVolume: Types.f32,
  /** Total capacity (liters) */
  capacity: Types.f32,
  /** Temperature (Kelvin) */
  temperatureK: Types.f32,
  /** Pressure (kPa gauge) */
  pressureKpaG: Types.f32,
  /** Heat leak rate (Watts) */
  heatLeakW: Types.f32,
});

// ─── Pump Component ───
// Models a centrifugal LN2 transfer pump
export const Pump = defineComponent('Pump', {
  /** Mode: 0=off, 1=starting, 2=running, 3=stopping, 4=fault */
  mode: Types.u8,
  /** Speed setpoint (0-100%) */
  speedSetpoint: Types.f32,
  /** Actual speed (0-100%) */
  actualSpeed: Types.f32,
  /** Current flow rate (L/min) */
  flowRate: Types.f32,
  /** Discharge pressure (kPa gauge) */
  dischargePressureKpaG: Types.f32,
  /** Power consumption (kW) */
  powerKW: Types.f32,
  /** Rated max flow (L/min) */
  ratedFlow: Types.f32,
  /** Rated max head (kPa) */
  ratedHead: Types.f32,
  /** Cavitation flag: 0=no, 1=yes */
  cavitating: Types.u8,
  /** Runtime (seconds) */
  runtime: Types.f32,
});

// ─── Valve Component ───
// Models an isolation/control valve
export const Valve = defineComponent('Valve', {
  /** Commanded position (0-100%) */
  positionSetpoint: Types.f32,
  /** Actual position (0-100%) */
  actualPosition: Types.f32,
  /** Cv at 100% open */
  cvFull: Types.f32,
  /** Stroke time (seconds) */
  strokeTime: Types.f32,
});

// ─── Tag Components for Entity Identification ───
export const SupplyTankTag = defineComponent('SupplyTankTag', {});
export const ReceiverTankTag = defineComponent('ReceiverTankTag', {});
export const SupplyValveTag = defineComponent('SupplyValveTag', {});
export const DischargeValveTag = defineComponent('DischargeValveTag', {});
export const VentValveTag = defineComponent('VentValveTag', {});

// ─── Pipe Connection Component ───
// Links a pump to its source/destination tanks and valves
export const PipeConnection = defineComponent('PipeConnection', {
  /** Entity ID of source tank */
  sourceTank: Types.u32,
  /** Entity ID of destination tank */
  destTank: Types.u32,
  /** Entity ID of supply valve */
  supplyValve: Types.u32,
  /** Entity ID of discharge valve */
  dischargeValve: Types.u32,
});

// ─── Pump mode enum (matches Pump.mode values) ───
export const PumpMode = {
  OFF: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  FAULT: 4,
} as const;
