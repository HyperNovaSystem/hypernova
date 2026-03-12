/**
 * ECS Systems for the LN2 pumping simulation.
 *
 * Systems process entities each tick to advance the physics.
 */

import { defineSystem, query } from '@nova/core';
import {
  Tank, Pump, Valve, PipeConnection,
  SupplyTankTag, ReceiverTankTag,
  SupplyValveTag, DischargeValveTag, VentValveTag,
  PumpMode,
} from './components.js';

// ─── LN2 Constants ───
const LN2_BOILING_K = 77.36;
const LN2_DENSITY = 808;       // kg/m³
const LN2_HVAP = 199.2;        // kJ/kg
const LN2_CP = 2.042;          // kJ/(kg·K)

function satPressureKpaG(tempK: number): number {
  const Pabs = 101.325 * Math.exp((199.2 * 28.014 / 8.314) * (1 / LN2_BOILING_K - 1 / tempK));
  return Math.max(0, Pabs - 101.325);
}

// ─── Valve Dynamics System ───

export const ValveDynamicsSystem = defineSystem({
  name: 'ValveDynamics',
  query: query(Valve).read(Valve).write(Valve),
  execute(ctx) {
    for (const eid of ctx.entities) {
      const setpoint = Valve.positionSetpoint[eid];
      let actual = Valve.actualPosition[eid];
      const strokeTime = Valve.strokeTime[eid];
      const diff = setpoint - actual;

      if (Math.abs(diff) < 0.1) {
        Valve.actualPosition[eid] = setpoint;
        continue;
      }

      const rate = 100 / strokeTime;
      const maxMove = rate * ctx.dt;
      if (Math.abs(diff) <= maxMove) {
        Valve.actualPosition[eid] = setpoint;
      } else {
        Valve.actualPosition[eid] = actual + Math.sign(diff) * maxMove;
      }
      Valve.actualPosition[eid] = clamp(Valve.actualPosition[eid], 0, 100);
    }
  },
});

// ─── Tank Thermodynamics System ───

export const TankThermoSystem = defineSystem({
  name: 'TankThermo',
  query: query(Tank).read(Tank).write(Tank),
  execute(ctx) {
    for (const eid of ctx.entities) {
      let vol = Tank.liquidVolume[eid];
      if (vol <= 0) {
        Tank.liquidVolume[eid] = 0;
        Tank.pressureKpaG[eid] = 0;
        continue;
      }

      const capacity = Tank.capacity[eid];
      const heatLeak = Tank.heatLeakW[eid];
      const tempK = Tank.temperatureK[eid];

      // Heat leak → boil-off
      const heatJ = heatLeak * ctx.dt;
      const boilMass = heatJ / (LN2_HVAP * 1000);
      const boilVol = (boilMass / LN2_DENSITY) * 1000;
      vol = Math.max(0, vol - boilVol);
      Tank.liquidVolume[eid] = vol;

      // Pressure from vapor
      const vaporSpace = capacity - vol;
      if (vaporSpace > 0) {
        const moles = boilMass / 0.028014;
        const dP = (moles * 8.314 * tempK) / (vaporSpace / 1000) / 1000;
        Tank.pressureKpaG[eid] += dP;
      }

      // Temperature rise
      const liquidMass = vol * LN2_DENSITY / 1000;
      if (liquidMass > 0) {
        Tank.temperatureK[eid] += heatJ / (liquidMass * LN2_CP * 1000);
      }

      // Saturation equilibrium
      const pSat = satPressureKpaG(Tank.temperatureK[eid]);
      Tank.pressureKpaG[eid] = Math.max(Tank.pressureKpaG[eid], pSat);

      // Natural pressure decay
      if (Tank.pressureKpaG[eid] > pSat + 5) {
        Tank.pressureKpaG[eid] -= (Tank.pressureKpaG[eid] - pSat) * 0.002 * ctx.dt;
      }
    }
  },
});

// ─── Pump Dynamics System ───

const PUMP_RAMP = 25;
const PUMP_STARTUP = 3;

export const PumpDynamicsSystem = defineSystem({
  name: 'PumpDynamics',
  query: query(Pump, PipeConnection).read(Pump, PipeConnection).write(Pump),
  execute(ctx) {
    for (const eid of ctx.entities) {
      const mode = Pump.mode[eid];
      const speed = Pump.actualSpeed[eid];

      switch (mode) {
        case PumpMode.OFF:
          Pump.actualSpeed[eid] = Math.max(0, speed - PUMP_RAMP * ctx.dt);
          Pump.flowRate[eid] = 0;
          Pump.powerKW[eid] = 0;
          Pump.dischargePressureKpaG[eid] = 0;
          break;

        case PumpMode.STARTING:
          Pump.actualSpeed[eid] = Math.min(speed + 5 * ctx.dt, 10);
          Pump.runtime[eid] += ctx.dt;
          if (Pump.runtime[eid] > PUMP_STARTUP) {
            Pump.mode[eid] = PumpMode.RUNNING;
          }
          break;

        case PumpMode.RUNNING: {
          const setpoint = Pump.speedSetpoint[eid];
          const diff = setpoint - speed;
          if (Math.abs(diff) > 0.5) {
            Pump.actualSpeed[eid] = speed + Math.sign(diff) * Math.min(PUMP_RAMP * ctx.dt, Math.abs(diff));
          }
          Pump.actualSpeed[eid] = clamp(Pump.actualSpeed[eid], 0, 100);
          Pump.runtime[eid] += ctx.dt;

          // Flow calculation
          calculatePumpFlow(eid, ctx.dt);
          break;
        }

        case PumpMode.STOPPING:
          Pump.actualSpeed[eid] = Math.max(0, speed - PUMP_RAMP * 1.5 * ctx.dt);
          if (Pump.actualSpeed[eid] <= 0) {
            Pump.mode[eid] = PumpMode.OFF;
          }
          Pump.flowRate[eid] = 0;
          break;

        case PumpMode.FAULT:
          Pump.actualSpeed[eid] = Math.max(0, speed - PUMP_RAMP * 3 * ctx.dt);
          Pump.flowRate[eid] = 0;
          break;
      }
    }
  },
});

function calculatePumpFlow(pumpEid: number, dt: number): void {
  const speed = Pump.actualSpeed[pumpEid];
  if (speed < 1) {
    Pump.flowRate[pumpEid] = 0;
    return;
  }

  const srcTank = PipeConnection.sourceTank[pumpEid];
  const dstTank = PipeConnection.destTank[pumpEid];
  const supValve = PipeConnection.supplyValve[pumpEid];
  const disValve = PipeConnection.dischargeValve[pumpEid];

  const cvSup = Valve.cvFull[supValve] * (Valve.actualPosition[supValve] / 100);
  const cvDis = Valve.cvFull[disValve] * (Valve.actualPosition[disValve] / 100);

  if (cvSup < 0.5 || cvDis < 0.5) {
    Pump.flowRate[pumpEid] = 0;
    Pump.cavitating[pumpEid] = cvSup < 0.5 && speed > 20 ? 1 : 0;
    Pump.powerKW[pumpEid] = 0.5 * (speed / 100);
    return;
  }

  const frac = speed / 100;
  const maxFlow = Pump.ratedFlow[pumpEid] * frac;
  const maxHead = Pump.ratedHead[pumpEid] * frac * frac;
  const staticHead = Tank.pressureKpaG[dstTank] - Tank.pressureKpaG[srcTank];
  const available = maxHead - Math.max(0, staticHead);

  if (available <= 0) {
    Pump.flowRate[pumpEid] = 0;
    Pump.dischargePressureKpaG[pumpEid] = Tank.pressureKpaG[srcTank] + maxHead;
    Pump.powerKW[pumpEid] = 0.8 * frac;
    return;
  }

  const systemCv = 1 / Math.sqrt(1 / (cvSup * cvSup) + 1 / (cvDis * cvDis));
  const flow = Math.min(maxFlow, systemCv * Math.sqrt(available) * 0.5);
  Pump.flowRate[pumpEid] = Math.max(0, flow);

  // Transfer liquid
  const transferVol = flow * dt / 60;
  if (Tank.liquidVolume[srcTank] >= transferVol) {
    Tank.liquidVolume[srcTank] -= transferVol;
    Tank.liquidVolume[dstTank] = Math.min(Tank.capacity[dstTank], Tank.liquidVolume[dstTank] + transferVol);
  }

  // Discharge pressure & power
  Pump.dischargePressureKpaG[pumpEid] = Tank.pressureKpaG[srcTank] + maxHead - (flow / maxFlow) * maxHead * 0.4;
  const eff = 0.65 * (1 - 0.3 * Math.pow(1 - frac, 2));
  Pump.powerKW[pumpEid] = (flow / 60000 * Pump.dischargePressureKpaG[pumpEid] * 1000) / (eff * 1000) + 0.3 * frac;

  // Cavitation check
  const suctionP = Tank.pressureKpaG[srcTank] - (flow / cvSup) * 2;
  const pSat = satPressureKpaG(Tank.temperatureK[srcTank]);
  Pump.cavitating[pumpEid] = suctionP < pSat - 10 ? 1 : 0;
}

// ─── Safety Interlock System ───

export const SafetySystem = defineSystem({
  name: 'Safety',
  query: query(Pump, PipeConnection).read(Pump, PipeConnection),
  execute(ctx) {
    for (const eid of ctx.entities) {
      if (Pump.mode[eid] !== PumpMode.RUNNING) continue;

      const srcTank = PipeConnection.sourceTank[eid];
      const dstTank = PipeConnection.destTank[eid];

      const srcLevel = (Tank.liquidVolume[srcTank] / Tank.capacity[srcTank]) * 100;
      const dstLevel = (Tank.liquidVolume[dstTank] / Tank.capacity[dstTank]) * 100;

      if (srcLevel < 5 || dstLevel > 95 || Pump.cavitating[eid] === 1) {
        Pump.mode[eid] = PumpMode.FAULT;
      }
    }
  },
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
