# Findings: LN2 Pumping System Control Dashboard

**Date:** 2026-03-12
**Scope:** Simulated industrial liquid-nitrogen pumping system with control dashboard

---

## 1. Architecture Overview

Two implementations were built:

1. **nitrogen_sim** — Standalone dashboard with self-contained physics simulation
2. **hypernova/examples/nitrogen-pump** — ECS-based implementation using the HyperNova engine

Both model the same physical system:
- Supply Dewar (5000 L) -> V-101 -> Pump P-101 -> V-102 -> Receiver Tank (2000 L)
- Vent valve V-103 on supply tank vapor space

---

## 2. Simulation Fidelity Issues

### 2.1 Simplified Thermodynamic Model

The saturation pressure calculation uses a Clausius-Clapeyron approximation rather than
NIST reference data or a proper equation of state (Span-Wagner for N2). This introduces
errors at pressures significantly above 1 atm. For a production control system trainer,
REFPROP or CoolProp integration would be necessary.

**Impact:** Low for demonstration purposes; moderate for operator training fidelity.

### 2.2 No Two-Phase Flow Modeling

The simulation treats the liquid as single-phase. Real LN2 transfer systems experience
two-phase flow during cool-down of warm piping, which causes pressure surges and flow
instability. The current model skips the cool-down transient entirely.

**Impact:** Operators would not experience realistic startup behavior.

### 2.3 Pump Curve Simplification

Pump performance uses affinity laws (Q ~ N, H ~ N^2) with a single operating point.
Real centrifugal pump curves are non-linear and shift with fluid properties. The model
also omits:
- NPSH required vs. available calculation (cavitation is detected but not rigorously modeled)
- Minimum flow recirculation
- Seal and bearing thermal limits

### 2.4 Heat Leak Model

Heat leak is modeled as constant wattage. In reality, heat leak varies with:
- Fill level (wetted area changes)
- Ambient temperature
- Vacuum jacket degradation
- Piping conduction paths

A more accurate model would use `Q = UA * (T_ambient - T_LN2)` with level-dependent UA.

---

## 3. Dashboard Deficiencies

### 3.1 No Historical Data Persistence

Trend data is held in memory only. Closing the browser tab loses all history.
A production dashboard would log to a time-series database (InfluxDB, TimescaleDB)
and support arbitrary time-range queries.

### 3.2 No Multi-User or SCADA Integration

The dashboard is single-user, client-side only. Industrial systems require:
- Role-based access control (operator vs. engineer vs. viewer)
- Audit trail for all control actions
- OPC-UA or Modbus integration for real I/O
- Redundant HMI with failover

### 3.3 Alarm Management Gaps

The alarm system is basic. A proper ISA-18.2 alarm management implementation would need:
- Alarm shelving and suppression
- State machine per alarm point (Active/Unacknowledged, Active/Acknowledged, Clear/Unacknowledged, Clear/Acknowledged)
- Alarm priority rationalization
- First-out annunciation
- Alarm flood detection and suppression

### 3.4 No Trend Scaling or Cursor

The trend chart uses fixed Y-axis ranges per series. Missing features:
- Auto-scaling
- Cursor/crosshair with readout
- Zoom and pan
- Multiple Y-axes for different units

---

## 4. HyperNova ECS Integration Findings

### 4.1 ECS Well-Suited for This Domain

The ECS architecture maps naturally to industrial simulation:
- **Entities** = physical equipment (tanks, pumps, valves)
- **Components** = measurable properties (pressure, temperature, flow, position)
- **Systems** = physics domains (thermodynamics, fluid flow, safety interlocks)

The SoA storage pattern provides cache-friendly iteration when processing many
similar entities (e.g., updating all valves, all tanks).

### 4.2 Component Type Limitations

HyperNova components only support numeric fields (f32, i32, u8, etc.). The pump
`mode` field (off/starting/running/stopping/fault) had to be encoded as a u8 with
magic numbers rather than a proper enum or string.

**Recommendation:** Consider adding a string or enum component field type, or document
the pattern of using integer codes with a companion const enum.

### 4.3 Entity Reference Pattern

The `PipeConnection` component stores entity IDs as u32 fields to link a pump to its
source tank, destination tank, and valves. This works but has no referential integrity —
if a referenced entity is destroyed, the stored ID becomes a dangling reference.

**Recommendation:** Add an `EntityRef` field type with optional liveness checks.

### 4.4 No Built-in Alarm/Event Log

The ECS event system is ephemeral (cleared each frame). Industrial simulations need
persistent event logs. The alarm system had to be implemented outside the ECS event
mechanism, stored as a plain array on the system state.

### 4.5 Query System Works Well for Simulation

The query API `query(Pump, PipeConnection).read(Pump).write(Pump)` expresses system
data dependencies clearly. However, the `.read()` and `.write()` annotations are not
enforced at runtime (noted in FINDINGS.md as MISSING-4).

---

## 5. Safety and Correctness Concerns

### 5.1 Interlock Timing

Safety interlocks (low level trip, high level trip, cavitation trip) execute once per
tick with no time delay. Real safety systems use:
- Confirmed alarms with settable time delays
- Voting logic (2oo3 for critical trips)
- Separate safety PLC (SIL-rated)

The simulation should add configurable interlock delays.

### 5.2 E-Stop Behavior

The E-Stop immediately commands valve closure and pump stop. A real E-Stop may:
- De-energize motor contactors directly (not through software)
- Open fail-safe vent valves (spring-return)
- Require physical reset before restart

The software E-Stop is realistic for a simulation trainer but should be labeled
as "software stop" to distinguish from a hardwired E-Stop.

### 5.3 No Deadband on Alarm Setpoints

Alarm conditions use simple threshold comparisons with no deadband, causing rapid
alarm chatter when a process variable oscillates near the setpoint. Add hysteresis
(e.g., alarm activates at 35 psig, clears at 33 psig).

---

## 6. Performance Observations

### 6.1 Simulation Step Cost

The physics simulation is lightweight — a single step takes <0.1 ms on modern hardware.
At 60 Hz with 20x time acceleration, we run 1200 steps/second comfortably.

### 6.2 Rendering Cost

Canvas 2D rendering (schematic + 8 gauges + trend chart) takes ~2-4 ms per frame.
This could be optimized by:
- Only redrawing gauges whose values changed
- Using offscreen canvases for static elements
- Switching to WebGL for the trend chart if data density increases

### 6.3 Memory

The standalone dashboard uses ~5 MB of heap. The trend buffer (600 data points x
6 series) is negligible. No memory leaks observed in extended runs.

---

## 7. Recommendations for Production Use

| Priority | Item | Effort |
|----------|------|--------|
| High | Replace thermodynamic model with CoolProp/REFPROP lookup tables | Medium |
| High | Add ISA-18.2 alarm state machine with deadband | Medium |
| High | Persist trend data to time-series DB | Medium |
| Medium | Add cool-down transient / two-phase flow model | High |
| Medium | Add interlock time delays and configurable setpoints | Low |
| Medium | Add operator action audit logging | Low |
| Low | Multi-axis trend chart with zoom/pan | Medium |
| Low | OPC-UA server for external HMI integration | High |
| Low | Responsive layout for tablet/mobile | Low |

---

## 8. Files Created

### nitrogen_sim (standalone dashboard)
- `src/simulation/models.ts` — Physical models (Tank, Pump, Valve, LN2 properties)
- `src/simulation/physics.ts` — Physics engine (thermodynamics, flow, interlocks, alarms)
- `src/dashboard/gauges.ts` — Radial gauge renderer
- `src/dashboard/schematic.ts` — P&ID schematic renderer
- `src/dashboard/trends.ts` — Scrolling trend chart
- `src/dashboard/alarms.ts` — Alarm display
- `src/main.ts` — Entry point wiring simulation to UI
- `src/styles.css` — Dashboard styling
- `index.html` — Dashboard layout

### hypernova (ECS example)
- `examples/nitrogen-pump/src/components.ts` — ECS component definitions
- `examples/nitrogen-pump/src/systems.ts` — ECS systems (valve, thermo, pump, safety)
- `examples/nitrogen-pump/src/renderer.ts` — Canvas renderer reading SoA data
- `examples/nitrogen-pump/src/main.ts` — Engine setup, entity spawning, UI controls
- `examples/nitrogen-pump/index.html` — Example page
