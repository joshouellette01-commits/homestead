// Derived rules shared by the sim, the renderer and the balance bots: player
// stats from upgrade levels, machine timings, plot prices, and which pads
// exist right now. Everything is computed from content.json plus state.
import type { BuildingPlotContent, Content, MachineContent, TrackId } from '../content';
import type { BuildingState, SimState } from './state';

export interface PlayerStats {
  capacity: number;
  walkSpeed: number;
  swingSeconds: number;
}

/** A track's value at a level, clamped to the levels content.json defines. */
export function trackValue(c: Content, track: TrackId, level: number): number {
  const values = c.characterTracks[track].values;
  return values[Math.min(Math.max(0, level), values.length - 1)] ?? 0;
}

export function maxLevel(c: Content, track: TrackId): number {
  return c.characterTracks[track].values.length - 1;
}

export function playerStats(s: SimState, c: Content): PlayerStats {
  return {
    capacity: trackValue(c, 'capacity', s.levels.capacity),
    walkSpeed: trackValue(c, 'walkSpeed', s.levels.walkSpeed),
    swingSeconds: trackValue(c, 'swingSeconds', s.levels.swingSeconds),
  };
}

const plotCache = new WeakMap<Content, BuildingPlotContent[]>();

/** Every building plot in content.json, in the same order as SimState.buildings. */
export function buildingPlots(c: Content): BuildingPlotContent[] {
  let plots = plotCache.get(c);
  if (!plots) {
    plots = c.zones.flatMap((z) => z.plots.filter((p): p is BuildingPlotContent => p.kind === 'building'));
    plotCache.set(c, plots);
  }
  return plots;
}

export function machineOf(c: Content, index: number): { plot: BuildingPlotContent; machine: MachineContent } | null {
  const plot = buildingPlots(c)[index];
  const machine = plot && c.machines[plot.machine];
  return plot && machine ? { plot, machine } : null;
}

/** Seconds per item at a speed level. */
export function cycleSeconds(c: Content, machine: MachineContent, level: number): number {
  return machine.cycleSeconds * c.buildingSpeed.cycleMultiplier ** level;
}

/**
 * Price of a machine's speed level (1-based): costMinutes of the income that
 * level adds, at the output's sell price. DESIGN.md's formula, not a typed number.
 */
export function speedCost(c: Content, machine: MachineContent, level: number): number {
  const perMinute = (l: number): number => 60 / cycleSeconds(c, machine, l);
  const price = c.items[machine.output]?.sellPrice ?? 0;
  return Math.round((perMinute(level) - perMinute(level - 1)) * price * c.buildingSpeed.costMinutes);
}

interface PadBase {
  id: string;
  x: number;
  z: number;
}

export type ActivePad =
  | (PadBase & { kind: 'sell' })
  | (PadBase & { kind: 'input' | 'output' | 'build' | 'speed'; building: number })
  | (PadBase & { kind: 'character'; track: TrackId });

/** Pads that exist in the current state: unbuilt plots, built machines' pads, and plots not yet maxed. */
export function activePads(s: SimState, c: Content): ActivePad[] {
  const pads: ActivePad[] = [];
  for (const zone of c.zones) {
    for (const p of zone.pads) pads.push({ kind: 'sell', id: p.id, x: p.x, z: p.z });
    for (const p of zone.plots) {
      if (p.kind === 'character') {
        if (s.levels[p.track] < maxLevel(c, p.track)) pads.push({ kind: 'character', id: p.id, x: p.x, z: p.z, track: p.track });
      }
    }
  }
  s.buildings.forEach((b, building) => {
    const plot = buildingPlots(c)[building];
    if (!plot) return;
    if (!b.built) {
      pads.push({ kind: 'build', id: plot.id, x: plot.x, z: plot.z, building });
      return;
    }
    const { inputPad, outputPad } = plot.site;
    pads.push({ kind: 'input', id: `${plot.id}-input`, x: inputPad.x, z: inputPad.z, building });
    pads.push({ kind: 'output', id: `${plot.id}-output`, x: outputPad.x, z: outputPad.z, building });
    if (b.speedLevel < c.buildingSpeed.levels) pads.push({ kind: 'speed', id: `${plot.id}-speed`, x: plot.x, z: plot.z, building });
  });
  return pads;
}

/** The pad whose trigger circle the player stands in. Pads never overlap, so there is at most one. */
export function padUnderPlayer(s: SimState, c: Content): ActivePad | null {
  const r = c.interaction.padRadius;
  for (const pad of activePads(s, c)) {
    if (Math.hypot(s.player.x - pad.x, s.player.z - pad.z) <= r) return pad;
  }
  return null;
}

export interface MaterialNeed {
  item: string;
  need: number;
  have: number;
}

/** What a plot pad asks for: cash, plus materials still to carry in. Null for pads that sell nothing. */
export interface PlotPrice {
  cash: number;
  materials: MaterialNeed[];
}

export function materialsDone(price: PlotPrice): boolean {
  return price.materials.every((m) => m.have >= m.need);
}

export function plotPrice(s: SimState, c: Content, pad: ActivePad): PlotPrice | null {
  switch (pad.kind) {
    case 'character': {
      const cost = c.characterTracks[pad.track].costs[s.levels[pad.track]];
      return cost === undefined ? null : { cash: cost, materials: [] };
    }
    case 'build': {
      const b = s.buildings[pad.building];
      const plot = buildingPlots(c)[pad.building];
      if (!b || !plot) return null;
      const materials = Object.entries(plot.materials).map(([item, need]) => ({ item, need, have: b.delivered[item] ?? 0 }));
      return { cash: plot.cash, materials };
    }
    case 'speed': {
      const b = s.buildings[pad.building];
      const m = machineOf(c, pad.building);
      if (!b || !m || b.speedLevel >= c.buildingSpeed.levels) return null;
      return { cash: speedCost(c, m.machine, b.speedLevel + 1), materials: [] };
    }
    default:
      return null;
  }
}

/** A built machine, or null. */
export function builtMachine(s: SimState, c: Content, index: number): { b: BuildingState; machine: MachineContent } | null {
  const b = s.buildings[index];
  const m = machineOf(c, index);
  return b?.built && m ? { b, machine: m.machine } : null;
}
