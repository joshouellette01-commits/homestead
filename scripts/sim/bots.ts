// Bots for the balance simulator. They play through the same joystick input
// the player has, so walking, collision, stop-to-sell, swing timing and the
// purchase ring all cost them exactly what they cost a person.
import type { Content } from '../../src/content';
import {
  activePads,
  buildingPlots,
  builtMachine,
  materialsDone,
  padUnderPlayer,
  playerStats,
  plotPrice,
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

function solids(s: SimState, c: Content, except: Point | null): Solid[] {
  const out: Solid[] = [];
  for (const n of s.nodes) {
    const type = c.nodeTypes[n.type];
    if (type && n !== except) out.push({ x: n.x, z: n.z, r: type.radius });
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
    if (ahead <= 0 || ahead > len) continue;
    const side = ox * dz - oz * dx; // >0: obstacle is to the right of travel
    if (Math.abs(side) >= o.r + clearance) continue;
    // Slide along the obstacle's tangent, on the side away from its centre.
    const sign = side > 0 ? 1 : -1;
    const tx = -dz * sign;
    const tz = dx * sign;
    const nx = dx + tx * 1.5;
    const nz = dz + tz * 1.5;
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

function nearestPad(s: SimState, pads: ActivePad[], kind: ActivePad['kind']): ActivePad | null {
  let best: ActivePad | null = null;
  let bestD = Infinity;
  for (const pad of pads) {
    if (pad.kind !== kind) continue;
    const d = Math.hypot(pad.x - s.player.x, pad.z - s.player.z);
    if (d < bestD) {
      bestD = d;
      best = pad;
    }
  }
  return best;
}

/** Nodes that give an item, if any; null means any node. */
function harvest(s: SimState, c: Content, item: string | null): SimInput {
  const p = s.player;
  const gives = (n: NodeState): boolean => item === null || c.nodeTypes[n.type]?.item === item;
  // Nearest ready node, else wait by the one that regrows soonest.
  let target: NodeState | null = null;
  let bestD = Infinity;
  for (const n of s.nodes) {
    if (n.remaining <= 0 || !gives(n)) continue;
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < bestD) {
      bestD = d;
      target = n;
    }
  }
  if (!target) {
    for (const n of s.nodes) if (gives(n) && (!target || n.regrowLeft < target.regrowLeft)) target = n;
  }
  if (!target) return NO_INPUT;
  const range = (c.nodeTypes[target.type]?.harvestRange ?? 1) * 0.9;
  return Math.hypot(target.x - p.x, target.z - p.z) <= range ? NO_INPUT : steer(s, c, target, target);
}

/** How many times a plot pad has been bought: a building once, upgrades per level. */
export function timesBought(s: SimState, c: Content, padId: string): number {
  for (const zone of c.zones) {
    for (const p of zone.plots) if (p.kind === 'character' && p.id === padId) return s.levels[p.track];
  }
  const plots = buildingPlots(c);
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i];
    const b = s.buildings[i];
    if (!plot || !b) continue;
    if (plot.id === padId) return b.built ? 1 : 0;
    if (`${plot.id}-speed` === padId) return b.speedLevel;
  }
  return 0;
}

/**
 * The shared playbook: carry materials to a chosen plot and buy it when the
 * cash is there; otherwise earn. Earning is hand-hauling: harvest until the
 * stack is full, then feed machines that take what you carry, collect their
 * output, and sell the rest.
 */
abstract class Planner implements Bot {
  abstract readonly name: string;
  private unloading = false;

  /** The plot pad to work toward, or null to just earn. */
  protected abstract goal(s: SimState, c: Content, pads: ActivePad[]): ActivePad | null;

  decide(s: SimState, c: Content): SimInput {
    const pads = activePads(s, c);
    const goal = this.goal(s, c, pads);
    return (goal && this.pursue(s, c, goal)) ?? this.earn(s, c, pads);
  }

  /** Input that works toward buying the goal, or null when the bot should earn meanwhile. */
  private pursue(s: SimState, c: Content, goal: ActivePad): SimInput | null {
    const price = plotPrice(s, c, goal);
    if (!price) return null;
    const p = s.player;
    const capacity = playerStats(s, c).capacity;
    const missing = price.materials.find((m) => m.have < m.need);
    if (missing) {
      const carried = p.stack.filter((i) => i === missing.item).length;
      const enough = carried >= missing.need - missing.have || p.stack.length >= capacity;
      if (carried > 0 && enough) return standOn(s, c, goal);
      if (p.stack.length >= capacity) return null; // full of other goods: earn (sell) first
      return harvest(s, c, missing.item);
    }
    if (!materialsDone(price) || s.cash < price.cash) return null;
    // A purchase locks plots until the player steps off; step away to buy the next level.
    if (s.purchase.locked && padUnderPlayer(s, c)) return steer(s, c, c.player.spawn, null);
    return standOn(s, c, goal);
  }

  private earn(s: SimState, c: Content, pads: ActivePad[]): SimInput {
    const p = s.player;
    const capacity = playerStats(s, c).capacity;
    const anyReady = s.nodes.some((n) => n.remaining > 0);
    if (p.stack.length >= capacity || (p.stack.length > 0 && !anyReady)) this.unloading = true;
    if (!this.unloading) return harvest(s, c, null);

    // Feed a machine that takes something we carry.
    for (const pad of pads) {
      if (pad.kind !== 'input') continue;
      const m = builtMachine(s, c, pad.building);
      if (m && m.b.input < m.machine.pileCapacity && p.stack.includes(m.machine.input)) return standOn(s, c, pad);
    }
    // Pick up finished goods while there is room.
    if (p.stack.length < capacity) {
      for (const pad of pads) {
        if (pad.kind !== 'output') continue;
        const m = builtMachine(s, c, pad.building);
        if (m && m.b.output > 0) return standOn(s, c, pad);
      }
    }
    const sell = nearestPad(s, pads, 'sell');
    if (p.stack.length > 0 && sell) return standOn(s, c, sell);
    this.unloading = false;
    return harvest(s, c, null);
  }
}

/** The cheapest plot it can afford right now; sticks with it until bought. */
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
