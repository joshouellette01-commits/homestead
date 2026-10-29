// Derived rules shared by the sim, the renderer and the balance bots: player
// stats from upgrade levels, machine timings, plot prices, and which pads
// exist right now. Everything is computed from content.json plus state.
import type { BuildingPlotContent, Content, MachineContent, TrackId, ZoneContent } from '../content';
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

interface Derived {
  plots: BuildingPlotContent[];
  /** Zone each building plot stands in. */
  plotZone: string[];
  /** Building plot id to its index. */
  index: Map<string, number>;
}

const cache = new WeakMap<Content, Derived>();

function derived(c: Content): Derived {
  let d = cache.get(c);
  if (!d) {
    const plots: BuildingPlotContent[] = [];
    const plotZone: string[] = [];
    for (const z of c.zones) {
      for (const p of z.plots) {
        if (p.kind !== 'building') continue;
        plots.push(p);
        plotZone.push(z.id);
      }
    }
    d = { plots, plotZone, index: new Map(plots.map((p, i) => [p.id, i])) };
    cache.set(c, d);
  }
  return d;
}

/** Every building plot in content.json, in the same order as SimState.buildings. */
export function buildingPlots(c: Content): BuildingPlotContent[] {
  return derived(c).plots;
}

/** Index of a building plot by id, or -1. */
export function buildingIndex(c: Content, plotId: string): number {
  return derived(c).index.get(plotId) ?? -1;
}

export function machineOf(c: Content, index: number): { plot: BuildingPlotContent; machine: MachineContent } | null {
  const plot = buildingPlots(c)[index];
  const machine = plot && c.machines[plot.machine];
  return plot && machine ? { plot, machine } : null;
}

/** The items a machine consumes: a processor's inputs, or an animal building's feed. */
export function machineInputs(machine: MachineContent): string[] {
  return machine.kind === 'processor' ? machine.inputs : [machine.feed];
}

/** How many of an input the building's own pile (or trough) holds. */
export function inputCapacity(machine: MachineContent): number {
  return machine.kind === 'processor' ? machine.pileCapacity : machine.troughCapacity;
}

/** Seconds per item at a level: faster cycles for processors, more animals for animal buildings. */
export function cycleSeconds(c: Content, machine: MachineContent, level: number): number {
  if (machine.kind === 'animals') return machine.secondsPerItem / (machine.animals + level);
  return machine.cycleSeconds * c.buildingSpeed.cycleMultiplier ** level;
}

/** Animals in an animal building at a herd level; 0 for processors. */
export function animalCount(machine: MachineContent, level: number): number {
  return machine.kind === 'animals' ? machine.animals + level : 0;
}

export function upgradeLevels(c: Content, machine: MachineContent): number {
  return machine.kind === 'animals' ? c.herdUpgrade.costFractions.length : c.buildingSpeed.levels;
}

/**
 * Price of a speed level (1-based): costMinutes of the income that level adds,
 * at the output's sell price. DESIGN.md's formula, not a typed number.
 */
export function speedCost(c: Content, machine: MachineContent, level: number): number {
  const perMinute = (l: number): number => 60 / cycleSeconds(c, machine, l);
  const price = c.items[machine.output]?.sellPrice ?? 0;
  return Math.round((perMinute(level) - perMinute(level - 1)) * price * c.buildingSpeed.costMinutes);
}

/** Price of a machine's next upgrade (1-based level): speed for processors, herd for animals. */
export function upgradeCost(c: Content, plot: BuildingPlotContent, machine: MachineContent, level: number): number {
  if (machine.kind === 'processor') return speedCost(c, machine, level);
  return Math.round(plot.cash * (c.herdUpgrade.costFractions[level - 1] ?? 0));
}

/** The zone a building plot stands in. */
export function plotZone(c: Content, index: number): string {
  return derived(c).plotZone[index] ?? '';
}

/** The zone a point is in, or null. */
export function zoneAt(c: Content, x: number, z: number): ZoneContent | null {
  return c.zones.find((zone) => x >= zone.bounds.minX && x <= zone.bounds.maxX && z >= zone.bounds.minZ && z <= zone.bounds.maxZ) ?? null;
}

interface PadBase {
  id: string;
  x: number;
  z: number;
}

export type ActivePad =
  | (PadBase & { kind: 'sell' })
  | (PadBase & { kind: 'input'; building: number; item: string })
  | (PadBase & { kind: 'output' | 'build' | 'upgrade'; building: number })
  | (PadBase & { kind: 'character'; track: TrackId })
  | (PadBase & { kind: 'gate'; zone: string });

/** Pads that exist in the current state, in owned zones only: unbuilt plots, built machines' pads, plots not yet maxed. */
export function activePads(s: SimState, c: Content): ActivePad[] {
  const pads: ActivePad[] = [];
  for (const zone of c.zones) {
    if (!s.zones[zone.id]) continue;
    for (const p of zone.pads) pads.push({ kind: 'sell', id: p.id, x: p.x, z: p.z });
    for (const p of zone.plots) {
      if (p.kind === 'character' && s.levels[p.track] < maxLevel(c, p.track)) {
        pads.push({ kind: 'character', id: p.id, x: p.x, z: p.z, track: p.track });
      }
      if (p.kind === 'gate' && !s.zones[p.zone]) pads.push({ kind: 'gate', id: p.id, x: p.x, z: p.z, zone: p.zone });
    }
  }
  s.buildings.forEach((b, building) => {
    const m = machineOf(c, building);
    if (!m || !s.zones[plotZone(c, building)]) return;
    const { plot, machine } = m;
    if (!b.built) {
      pads.push({ kind: 'build', id: plot.id, x: plot.x, z: plot.z, building });
      return;
    }
    for (const [item, where] of Object.entries(plot.site.inputs)) {
      if ('pad' in where) pads.push({ kind: 'input', id: `${plot.id}-input-${item}`, x: where.pad.x, z: where.pad.z, building, item });
    }
    const out = plot.site.outputPad;
    pads.push({ kind: 'output', id: `${plot.id}-output`, x: out.x, z: out.z, building });
    if (b.level < upgradeLevels(c, machine)) pads.push({ kind: 'upgrade', id: `${plot.id}-upgrade`, x: plot.x, z: plot.z, building });
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
    case 'gate': {
      const zone = c.zones.find((z) => z.id === pad.zone);
      return zone && !s.zones[zone.id] ? { cash: zone.gateCost, materials: [] } : null;
    }
    case 'build': {
      const b = s.buildings[pad.building];
      const plot = buildingPlots(c)[pad.building];
      if (!b || !plot) return null;
      const materials = Object.entries(plot.materials).map(([item, need]) => ({ item, need, have: b.delivered[item] ?? 0 }));
      return { cash: plot.cash, materials };
    }
    case 'upgrade': {
      const b = s.buildings[pad.building];
      const m = machineOf(c, pad.building);
      if (!b || !m || b.level >= upgradeLevels(c, m.machine)) return null;
      return { cash: upgradeCost(c, m.plot, m.machine, b.level + 1), materials: [] };
    }
    default:
      return null;
  }
}

/** A built machine, or null. */
export function builtMachine(
  s: SimState,
  c: Content,
  index: number,
): { b: BuildingState; machine: MachineContent; plot: BuildingPlotContent } | null {
  const b = s.buildings[index];
  const m = machineOf(c, index);
  return b?.built && m ? { b, machine: m.machine, plot: m.plot } : null;
}

/**
 * Where a building's input comes from: its own pile (or trough), or another
 * built building's output pile. Null when that other building isn't built.
 */
export function inputSource(s: SimState, c: Content, index: number, item: string): { count: number; take: () => void } | null {
  const m = builtMachine(s, c, index);
  const where = m?.plot.site.inputs[item];
  if (!m || !where) return null;
  if ('from' in where) {
    const other = s.buildings[buildingIndex(c, where.from)];
    if (!other?.built) return null;
    return { count: other.output, take: () => void (other.output -= 1) };
  }
  const b = m.b;
  return { count: b.inputs[item] ?? 0, take: () => void (b.inputs[item] = (b.inputs[item] ?? 0) - 1) };
}
