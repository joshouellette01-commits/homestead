// Bots for the balance simulator. They play through the same joystick input
// the player has, so walking, collision, stop-to-sell, swing timing and the
// purchase ring all cost them exactly what they cost a person.
import type { Content } from '../../src/content';
import {
  activePads,
  buildingIndex,
  buildingPlots,
  builtMachine,
  inputCapacity,
  inputSource,
  machineInputs,
  materialsDone,
  padUnderPlayer,
  playerStats,
  plotPrice,
  plotZone,
  type ActivePad,
} from '../../src/sim/plots';
import type { NodeState, SimInput, SimState } from '../../src/sim/state';
import { NO_INPUT } from '../../src/sim/state';

export interface Bot {
  readonly name: string;
  decide(s: SimState, c: Content): SimInput;
}

interface Point {
  x: number;
  z: number;
}

interface Solid extends Point {
  r: number;
}

/** Recursion guard for working back through a production chain. */
const MAX_DEPTH = 6;

function solids(s: SimState, c: Content, except: Point | null): Solid[] {
  const out: Solid[] = [];
  for (const n of s.nodes) {
    const type = c.nodeTypes[n.type];
    if (type?.solid && n !== except) out.push({ x: n.x, z: n.z, r: type.radius });
  }
  for (const zone of c.zones) for (const p of zone.props) out.push({ x: p.x, z: p.z, r: p.radius });
  buildingPlots(c).forEach((plot, i) => {
    const machine = c.machines[plot.machine];
    if (s.buildings[i]?.built && machine) out.push({ x: plot.site.x, z: plot.site.z, r: machine.radius });
  });
  return out;
}

/** Full-deflection input toward a target, steering around the first solid in the way. */
function steer(s: SimState, c: Content, target: Point, targetSolid: Point | null): SimInput {
  const p = s.player;
  let dx = target.x - p.x;
  let dz = target.z - p.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return NO_INPUT;
  dx /= len;
  dz /= len;
  const clearance = c.player.radius + 0.1;
  for (const o of solids(s, c, targetSolid)) {
    const ox = o.x - p.x;
    const oz = o.z - p.z;
    const ahead = ox * dx + oz * dz;
    // Only obstacles just ahead matter; far ones are dealt with on arrival.
    if (ahead <= 0 || ahead > Math.min(len, o.r + clearance + 1)) continue;
    const side = ox * dz - oz * dx;
    if (Math.abs(side) >= o.r + clearance) continue;
    // Slide round the obstacle along whichever tangent heads toward the
    // target, drifting outward a little. Choosing by the target (not by which
    // side of the path the centre is on) stays steady as the bot moves.
    const rx = -ox / Math.hypot(ox, oz);
    const rz = -oz / Math.hypot(ox, oz);
    const flip = -rz * dx + rx * dz >= 0 ? 1 : -1;
    const nx = -rz * flip + rx * 0.3 + dx * 0.5;
    const nz = rx * flip + rz * 0.3 + dz * 0.5;
    const m = Math.hypot(nx, nz);
    return { x: nx / m, z: nz / m };
  }
  return { x: dx, z: dz };
}

/** Walk to a pad and stop well inside its trigger circle; stopping is what sells. */
function standOn(s: SimState, c: Content, pad: Point): SimInput {
  const d = Math.hypot(pad.x - s.player.x, pad.z - s.player.z);
  return d <= c.interaction.padRadius * 0.5 ? NO_INPUT : steer(s, c, pad, null);
}

function nearest<T extends Point>(s: SimState, points: readonly T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - s.player.x, p.z - s.player.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const carried = (s: SimState, item: string): number => s.player.stack.filter((i) => i === item).length;

/** Owned-zone nodes that give an item. */
function nodesFor(s: SimState, c: Content, item: string): NodeState[] {
  return s.nodes.filter((n) => s.zones[n.zone] === true && c.nodeTypes[n.type]?.item === item);
}

/** Harvest the nearest ready node giving an item, else wait by the one that regrows soonest. */
function harvest(s: SimState, c: Content, item: string): SimInput | null {
  const nodes = nodesFor(s, c, item);
  if (nodes.length === 0) return null;
  let target = nearest(s, nodes.filter((n) => n.remaining > 0));
  if (!target) for (const n of nodes) if (!target || n.regrowLeft < target.regrowLeft) target = n;
  if (!target) return null;
  const range = (c.nodeTypes[target.type]?.harvestRange ?? 1) * 0.9;
  const solid = c.nodeTypes[target.type]?.solid ? target : null;
  return Math.hypot(target.x - s.player.x, target.z - s.player.z) <= range ? NO_INPUT : steer(s, c, target, solid);
}

/** The built machine (in an owned zone) that makes an item, or -1. */
function producer(s: SimState, c: Content, item: string): number {
  return buildingPlots(c).findIndex(
    (p, i) => s.buildings[i]?.built === true && s.zones[plotZone(c, i)] === true && c.machines[p.machine]?.output === item,
  );
}

/** Whether the bot could come by an item at all right now: a node to harvest, or a working chain. */
function obtainable(s: SimState, c: Content, item: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (nodesFor(s, c, item).length > 0) return true;
  const i = producer(s, c, item);
  const m = i >= 0 ? builtMachine(s, c, i) : null;
  if (!m) return false;
  return machineInputs(m.machine).every((input) => {
    const where = m.plot.site.inputs[input];
    if (where && 'from' in where) return s.buildings[buildingIndex(c, where.from)]?.built === true && obtainable(s, c, input, depth + 1);
    return obtainable(s, c, input, depth + 1);
  });
}

function outputPad(pads: readonly ActivePad[], building: number): ActivePad | null {
  return pads.find((p) => p.kind === 'output' && p.building === building) ?? null;
}

function inputPad(pads: readonly ActivePad[], building: number, item: string): ActivePad | null {
  return pads.find((p) => p.kind === 'input' && p.building === building && p.item === item) ?? null;
}

/**
 * Works toward having an item: harvest it, or run the machine that makes it.
 * Null when there is nothing useful to do for the item.
 */
function work(s: SimState, c: Content, pads: readonly ActivePad[], item: string, depth = 0): SimInput | null {
  if (depth > MAX_DEPTH) return null;
  const fromNodes = harvest(s, c, item);
  if (fromNodes) return fromNodes;
  const i = producer(s, c, item);
  return i >= 0 ? feed(s, c, pads, i, depth, true) : null;
}

/**
 * Runs a machine: collects its output once there is a stack's worth (or it has
 * stopped), delivers inputs being carried, and otherwise keeps its input piles
 * topped up, scarcest first. An input fed from another building's pile means
 * feeding that building instead, without taking its output. It never stands
 * waiting: with every pile full and little output, it returns null.
 */
function feed(s: SimState, c: Content, pads: readonly ActivePad[], i: number, depth: number, collect: boolean): SimInput | null {
  const m = builtMachine(s, c, i);
  if (!m) return null;
  const { b, machine, plot } = m;
  const room = playerStats(s, c).capacity - s.player.stack.length;
  const inputs = machineInputs(machine);
  const running = inputs.every((input) => (inputSource(s, c, i, input)?.count ?? 0) > 0);
  const out = outputPad(pads, i);
  if (collect && out && room > 0 && b.output > 0 && (b.output >= room || !running)) return standOn(s, c, out);
  const count = (input: string): number => inputSource(s, c, i, input)?.count ?? 0;
  const deliver = (input: string): SimInput | null => {
    const pad = inputPad(pads, i, input);
    return pad && carried(s, input) > 0 && (b.inputs[input] ?? 0) < inputCapacity(machine) ? standOn(s, c, pad) : null;
  };
  // Carrying a load worth the walk (enough to fill the pile, or a full stack): drop it off.
  for (const input of inputs) {
    const space = inputCapacity(machine) - (b.inputs[input] ?? 0);
    if (room === 0 || carried(s, input) >= space) {
      const next = deliver(input);
      if (next) return next;
    }
  }
  // Otherwise gather more, scarcest input first. An input fed from another
  // building's pile means feeding that building, without taking its output.
  for (const input of [...inputs].sort((x, y) => count(x) - count(y))) {
    const where = plot.site.inputs[input];
    if (where && 'from' in where) {
      if (count(input) > 0) continue;
      const next = feed(s, c, pads, buildingIndex(c, where.from), depth + 1, false);
      if (next) return next;
      continue;
    }
    if (room > 0 && count(input) + carried(s, input) < inputCapacity(machine)) {
      const next = work(s, c, pads, input, depth + 1);
      if (next) return next;
    }
  }
  // Nothing left to gather: drop off what it has, then take what there is.
  for (const input of inputs) {
    const next = deliver(input);
    if (next) return next;
  }
  return collect && out && room > 0 && b.output > 0 ? standOn(s, c, out) : null;
}

/** How many times a plot pad has been bought: a gate or building once, upgrades per level. */
export function timesBought(s: SimState, c: Content, padId: string): number {
  for (const zone of c.zones) {
    for (const p of zone.plots) {
      if (p.kind === 'character' && p.id === padId) return s.levels[p.track];
      if (p.kind === 'gate' && p.id === padId) return s.zones[p.zone] ? 1 : 0;
    }
  }
  const plots = buildingPlots(c);
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i];
    const b = s.buildings[i];
    if (!plot || !b) continue;
    if (plot.id === padId) return b.built ? 1 : 0;
    if (`${plot.id}-upgrade` === padId) return b.level;
  }
  return 0;
}

/**
 * The shared playbook: carry materials to a chosen plot and buy it when the
 * cash is there; otherwise earn by making the most valuable good it can and
 * selling it.
 */
abstract class Planner implements Bot {
  abstract readonly name: string;
  private unloading = false;

  /** The plot pad to work toward, or null to just earn. */
  protected abstract goal(s: SimState, c: Content, pads: ActivePad[]): ActivePad | null;

  decide(s: SimState, c: Content): SimInput {
    const pads = activePads(s, c);
    const goal = this.goal(s, c, pads);
    return (goal && this.pursue(s, c, pads, goal)) ?? this.earn(s, c, pads);
  }

  /** Input that works toward buying the goal, or null when the bot should earn meanwhile. */
  private pursue(s: SimState, c: Content, pads: ActivePad[], goal: ActivePad): SimInput | null {
    const price = plotPrice(s, c, goal);
    if (!price) return null;
    const capacity = playerStats(s, c).capacity;
    const missing = price.materials.find((m) => m.have < m.need);
    if (missing) {
      const have = carried(s, missing.item);
      const enough = have >= missing.need - missing.have || s.player.stack.length >= capacity;
      if (have > 0 && enough) return standOn(s, c, goal);
      if (s.player.stack.length >= capacity) return null; // full of other goods: earn (sell) first
      return work(s, c, pads, missing.item);
    }
    if (!materialsDone(price) || s.cash < price.cash) return null;
    // A purchase locks plots until the player steps off; step away to buy the next level.
    if (s.purchase.locked && padUnderPlayer(s, c)) return steer(s, c, c.player.spawn, null);
    return standOn(s, c, goal);
  }

  /** Filler work when the main chain needs nothing: harvest the best raw good to sell. */
  private filler(s: SimState, c: Content): SimInput | null {
    const raws = [...new Set(s.nodes.filter((n) => s.zones[n.zone]).map((n) => c.nodeTypes[n.type]?.item ?? ''))];
    raws.sort((a, z) => (c.items[z]?.sellPrice ?? 0) - (c.items[a]?.sellPrice ?? 0));
    for (const item of raws) {
      const next = harvest(s, c, item);
      if (next) return next;
    }
    return null;
  }

  /** The most valuable item it can come by right now. */
  private bestGood(s: SimState, c: Content): string | null {
    let best: string | null = null;
    let bestPrice = -1;
    for (const [id, item] of Object.entries(c.items)) {
      if (item.sellPrice > bestPrice && obtainable(s, c, id)) {
        best = id;
        bestPrice = item.sellPrice;
      }
    }
    return best;
  }

  private earn(s: SimState, c: Content, pads: ActivePad[]): SimInput {
    const p = s.player;
    const capacity = playerStats(s, c).capacity;
    const good = this.bestGood(s, c);
    const next = p.stack.length < capacity ? ((good ? work(s, c, pads, good) : null) ?? this.filler(s, c)) : null;
    if (p.stack.length >= capacity || (p.stack.length > 0 && !next)) this.unloading = true;
    if (p.stack.length === 0) this.unloading = false;
    if (!this.unloading) return next ?? NO_INPUT;

    // Unload: feed machines anything they take (but not the good itself, which
    // is for selling), then sell the rest.
    const feedPads = pads.filter((pad) => {
      if (pad.kind !== 'input' || pad.item === good || !p.stack.includes(pad.item)) return false;
      const m = builtMachine(s, c, pad.building);
      return m !== null && (m.b.inputs[pad.item] ?? 0) < inputCapacity(m.machine);
    });
    const target = nearest(s, feedPads) ?? nearest(s, pads.filter((pad) => pad.kind === 'sell'));
    return target ? standOn(s, c, target) : NO_INPUT;
  }
}

/** The cheapest plot it can afford right now. */
function cheapestAffordable(s: SimState, c: Content, pads: ActivePad[]): ActivePad | null {
  let best: ActivePad | null = null;
  let bestCash = Infinity;
  for (const pad of pads) {
    const price = plotPrice(s, c, pad);
    if (price && price.cash <= s.cash && price.cash < bestCash) {
      bestCash = price.cash;
      best = pad;
    }
  }
  return best;
}

/** Buys the cheapest affordable plot, otherwise hauls the highest-value good. */
export class GreedyBot extends Planner {
  readonly name = 'greedy';
  private target: { id: string; bought: number } | null = null;

  protected goal(s: SimState, c: Content, pads: ActivePad[]): ActivePad | null {
    if (this.target) {
      const { id, bought } = this.target;
      const pad = pads.find((p) => p.id === id);
      if (pad && timesBought(s, c, id) === bought) return pad;
      this.target = null;
    }
    const pick = cheapestAffordable(s, c, pads);
    if (pick) this.target = { id: pick.id, bought: timesBought(s, c, pick.id) };
    return pick;
  }
}

/**
 * Follows a hand-written build order (scripts/sim/priority-order.json),
 * saving up for each entry in turn. A plot id listed twice buys two levels.
 * Once the order is done it buys like the greedy bot.
 */
export class PriorityBot extends Planner {
  readonly name = 'priority';
  constructor(readonly order: readonly string[]) {
    super();
  }

  protected goal(s: SimState, c: Content, pads: ActivePad[]): ActivePad | null {
    const seen = new Map<string, number>();
    for (const id of this.order) {
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      if (timesBought(s, c, id) >= n) continue;
      // Listed but not buyable yet (or ever): skip to the next entry.
      const pad = pads.find((p) => p.id === id);
      if (pad) return pad;
    }
    return cheapestAffordable(s, c, pads);
  }
}
