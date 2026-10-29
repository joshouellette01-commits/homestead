// Bots for the balance simulator. They play through the same joystick input
// the player has, so walking, collision, stop-to-sell and swing timing all
// cost them exactly what they cost a person.
import type { Content } from '../../src/content';
import type { SimInput, SimState } from '../../src/sim/state';
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

function nearestSellPad(s: SimState, c: Content): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const zone of c.zones) {
    for (const pad of zone.pads) {
      if (pad.kind !== 'sell') continue;
      const d = Math.hypot(pad.x - s.player.x, pad.z - s.player.z);
      if (d < bestD) {
        bestD = d;
        best = pad;
      }
    }
  }
  return best;
}

/**
 * Hand-hauling: harvest the nearest ready node until the stack is full (or
 * nothing is ready), then walk to a sell pad and stand still until it is empty.
 * Both bots fall back to this when there is nothing to buy.
 */
export class Hauler {
  private selling = false;

  decide(s: SimState, c: Content): SimInput {
    const p = s.player;
    const full = p.stack.length >= c.player.capacity;
    const anyReady = s.nodes.some((n) => n.remaining > 0);
    if (full || (p.stack.length > 0 && !anyReady)) this.selling = true;
    if (p.stack.length === 0) this.selling = false;

    if (this.selling) {
      const pad = nearestSellPad(s, c);
      if (!pad) return NO_INPUT;
      const d = Math.hypot(pad.x - p.x, pad.z - p.z);
      // Stop well inside the trigger circle; stopping is what sells.
      return d <= c.interaction.padRadius * 0.5 ? NO_INPUT : steer(s, c, pad, null);
    }

    // Nearest ready node, else wait by the one that regrows soonest.
    let target = null as (typeof s.nodes)[number] | null;
    let bestD = Infinity;
    for (const n of s.nodes) {
      if (n.remaining <= 0) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD) {
        bestD = d;
        target = n;
      }
    }
    if (!target) {
      for (const n of s.nodes) if (!target || n.regrowLeft < target.regrowLeft) target = n;
    }
    if (!target) return NO_INPUT;
    const type = c.nodeTypes[target.type];
    const range = (type?.harvestRange ?? 1) * 0.9;
    return Math.hypot(target.x - p.x, target.z - p.z) <= range ? NO_INPUT : steer(s, c, target, target);
  }
}

/** Buys the cheapest affordable plot, otherwise hauls the highest-value good. */
export class GreedyBot implements Bot {
  readonly name = 'greedy';
  private readonly hauler = new Hauler();
  decide(s: SimState, c: Content): SimInput {
    // No plots exist in content.json until phase 3, so hauling is all there is.
    return this.hauler.decide(s, c);
  }
}

/** Follows a hand-written build order (scripts/sim/priority-order.json). */
export class PriorityBot implements Bot {
  readonly name = 'priority';
  private readonly hauler = new Hauler();
  constructor(readonly order: readonly string[]) {}
  decide(s: SimState, c: Content): SimInput {
    // Purchases arrive with plots in phase 3; until then, haul.
    return this.hauler.decide(s, c);
  }
}
