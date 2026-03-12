/**
 * Canvas renderer for the ECS-based LN2 pump simulation.
 * Reads component data directly from SoA arrays.
 */

import {
  Tank, Pump, Valve, PipeConnection,
  PumpMode,
} from './components.js';

interface RenderEntities {
  supplyTank: number;
  receiverTank: number;
  pump: number;
  supplyValve: number;
  dischargeValve: number;
  ventValve: number;
}

export function renderFrame(
  canvas: HTMLCanvasElement,
  entities: RenderEntities,
  tickCount: number,
): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const { supplyTank, receiverTank, pump, supplyValve, dischargeValve, ventValve } = entities;
  const hasFlow = Pump.flowRate[pump] > 0.1;

  // Supply tank
  drawTank(ctx, 50, 60, 120, 220, 'Supply Dewar',
    (Tank.liquidVolume[supplyTank] / Tank.capacity[supplyTank]) * 100);

  // Labels
  ctx.font = '10px monospace';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'left';
  ctx.fillText(`P: ${(Tank.pressureKpaG[supplyTank] / 6.895).toFixed(1)} psig`, 55, 300);
  ctx.fillText(`T: ${(Tank.temperatureK[supplyTank] - 273.15).toFixed(1)}°C`, 55, 314);
  ctx.fillText(`L: ${((Tank.liquidVolume[supplyTank] / Tank.capacity[supplyTank]) * 100).toFixed(1)}%`, 55, 328);

  // Pipe supply → V-101
  drawPipe(ctx, 170, 170, 220, 170, hasFlow);

  // V-101
  drawValve(ctx, 235, 170, Valve.actualPosition[supplyValve], 'V-101');

  // Pipe V-101 → pump
  drawPipe(ctx, 260, 170, 320, 170, hasFlow);

  // Pump
  drawPumpSymbol(ctx, 340, 170, Pump.mode[pump], Pump.actualSpeed[pump]);

  // Pipe pump → V-102
  drawPipe(ctx, 370, 170, 430, 170, hasFlow);

  // V-102
  drawValve(ctx, 445, 170, Valve.actualPosition[dischargeValve], 'V-102');

  // Pipe V-102 → receiver
  drawPipe(ctx, 470, 170, 530, 170, hasFlow);

  // Receiver tank
  drawTank(ctx, 530, 60, 120, 220, 'Receiver',
    (Tank.liquidVolume[receiverTank] / Tank.capacity[receiverTank]) * 100);

  ctx.font = '10px monospace';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'left';
  ctx.fillText(`P: ${(Tank.pressureKpaG[receiverTank] / 6.895).toFixed(1)} psig`, 535, 300);
  ctx.fillText(`T: ${(Tank.temperatureK[receiverTank] - 273.15).toFixed(1)}°C`, 535, 314);
  ctx.fillText(`L: ${((Tank.liquidVolume[receiverTank] / Tank.capacity[receiverTank]) * 100).toFixed(1)}%`, 535, 328);

  // Vent line
  drawPipe(ctx, 110, 60, 110, 30, Valve.actualPosition[ventValve] > 5);
  drawPipe(ctx, 110, 30, 190, 30, Valve.actualPosition[ventValve] > 5);
  drawValve(ctx, 205, 30, Valve.actualPosition[ventValve], 'V-103');
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'left';
  ctx.fillText('ATM', 230, 34);

  // Pump info
  const modeNames = ['OFF', 'STARTING', 'RUNNING', 'STOPPING', 'FAULT'];
  const modeColors = ['#8b949e', '#d29922', '#3fb950', '#d29922', '#f85149'];
  const m = Pump.mode[pump];
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = modeColors[m] ?? '#8b949e';
  ctx.textAlign = 'center';
  ctx.fillText(`P-101 [${modeNames[m]}]`, 340, 210);
  ctx.fillText(`${Pump.actualSpeed[pump].toFixed(0)}% | ${Pump.flowRate[pump].toFixed(1)} L/min`, 340, 226);
  ctx.fillText(`${Pump.powerKW[pump].toFixed(1)} kW`, 340, 242);

  // Flow arrows (animated)
  if (hasFlow) {
    const t = (tickCount * 0.05) % 1;
    for (const xBase of [190, 290, 400, 500]) {
      const ax = xBase + t * 30;
      drawFlowArrow(ctx, ax, 166);
    }
  }

  // Tick counter
  ctx.font = '10px monospace';
  ctx.fillStyle = '#58a6ff';
  ctx.textAlign = 'right';
  ctx.fillText(`Tick: ${tickCount}`, w - 10, h - 10);
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  label: string, level: number,
): void {
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  const fillH = h * Math.min(1, Math.max(0, level / 100));
  ctx.fillStyle = 'rgba(57, 210, 192, 0.35)';
  ctx.fillRect(x + 1, y + h - fillH, w - 2, fillH - 1);

  if (level > 0 && level < 100) {
    ctx.beginPath();
    ctx.moveTo(x + 1, y + h - fillH);
    ctx.lineTo(x + w - 1, y + h - fillH);
    ctx.strokeStyle = '#39d2c0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#58a6ff';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y - 8);
}

function drawPipe(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  flowing: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = flowing ? '#39d2c0' : '#30363d';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawValve(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, position: number, label: string,
): void {
  const sz = 12;
  ctx.beginPath();
  ctx.moveTo(x - sz, y - sz);
  ctx.lineTo(x + sz, y + sz);
  ctx.lineTo(x + sz, y - sz);
  ctx.lineTo(x - sz, y + sz);
  ctx.closePath();

  const color = position > 90 ? '#3fb950' : position < 5 ? '#f85149' : '#d29922';
  ctx.fillStyle = color + '40';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'center';
  ctx.fillText(`${label} ${position.toFixed(0)}%`, x, y + sz + 12);
}

function drawPumpSymbol(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, mode: number, speed: number,
): void {
  const r = 22;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const colors = ['#8b949e', '#d29922', '#3fb950', '#d29922', '#f85149'];
  const c = colors[mode] ?? '#8b949e';
  ctx.fillStyle = c + '30';
  ctx.fill();
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 12, y - 14);
  ctx.lineTo(x - 12, y + 14);
  ctx.lineTo(x + 16, y);
  ctx.closePath();
  ctx.fillStyle = c;
  ctx.fill();
}

function drawFlowArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 5, y - 4);
  ctx.lineTo(x - 5, y + 4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(57, 210, 192, 0.5)';
  ctx.fill();
}

export function updateInfoPanel(el: HTMLElement, entities: RenderEntities): void {
  const { supplyTank, receiverTank, pump, supplyValve, dischargeValve, ventValve } = entities;
  const modeNames = ['OFF', 'STARTING', 'RUNNING', 'STOPPING', 'FAULT'];
  const m = Pump.mode[pump];
  const modeClass = m === 2 ? 'ok' : m === 4 ? 'crit' : m === 1 || m === 3 ? 'warn' : '';

  el.innerHTML = `
    <h3>Supply Dewar</h3>
    <span class="label">Level:</span> <span class="val">${((Tank.liquidVolume[supplyTank] / Tank.capacity[supplyTank]) * 100).toFixed(1)}%</span><br>
    <span class="label">Pressure:</span> <span class="val">${(Tank.pressureKpaG[supplyTank] / 6.895).toFixed(2)} psig</span><br>
    <span class="label">Temp:</span> <span class="val">${(Tank.temperatureK[supplyTank] - 273.15).toFixed(2)}°C</span><br>

    <h3>Transfer Pump P-101</h3>
    <span class="label">Status:</span> <span class="${modeClass}">${modeNames[m]}</span><br>
    <span class="label">Speed:</span> <span class="val">${Pump.actualSpeed[pump].toFixed(1)}%</span><br>
    <span class="label">Flow:</span> <span class="val">${Pump.flowRate[pump].toFixed(1)} L/min</span><br>
    <span class="label">Disch P:</span> <span class="val">${(Pump.dischargePressureKpaG[pump] / 6.895).toFixed(1)} psig</span><br>
    <span class="label">Power:</span> <span class="val">${Pump.powerKW[pump].toFixed(2)} kW</span><br>
    <span class="label">Cavitating:</span> <span class="${Pump.cavitating[pump] ? 'crit' : 'ok'}">${Pump.cavitating[pump] ? 'YES' : 'No'}</span><br>

    <h3>Receiver Tank</h3>
    <span class="label">Level:</span> <span class="val">${((Tank.liquidVolume[receiverTank] / Tank.capacity[receiverTank]) * 100).toFixed(1)}%</span><br>
    <span class="label">Pressure:</span> <span class="val">${(Tank.pressureKpaG[receiverTank] / 6.895).toFixed(2)} psig</span><br>
    <span class="label">Temp:</span> <span class="val">${(Tank.temperatureK[receiverTank] - 273.15).toFixed(2)}°C</span><br>

    <h3>Valves</h3>
    <span class="label">V-101 (supply):</span> <span class="val">${Valve.actualPosition[supplyValve].toFixed(0)}%</span><br>
    <span class="label">V-102 (disch):</span> <span class="val">${Valve.actualPosition[dischargeValve].toFixed(0)}%</span><br>
    <span class="label">V-103 (vent):</span> <span class="val">${Valve.actualPosition[ventValve].toFixed(0)}%</span>
  `;
}
