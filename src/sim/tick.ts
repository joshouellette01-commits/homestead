// One fixed step of the game rules. Every number comes from content.json and
// is read on each call, so live tuning in ?debug takes effect immediately.
import type { Bounds, Content } from '../content';
import type { SimInput, SimState } from './state';

/** Fixed simulation step, shared by the game loop and the balance simulator. */
export const SIM_DT = 1 / 60;

/** Absorbs float drift so timers summed from SIM_DT fire on the step they should. */
const EPS = 1e-9;

export type SimEvent =
  | { type: 'harvest'; node: number; item: string }
  | { type: 'sell'; item: string; price: number };

interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Zones the player can walk in. Gates arrive in phase 3; until then, free zones only. */
export function ownedZoneBounds(c: Content): Bounds[] {
  return c.zones.filter((z) => z.gateCost === 0).map((z) => z.bounds);
}

function obstacles(s: SimState, c: Content): Circle[] {
  const out: Circle[] = [];
  for (const n of s.nodes) {
    const type = c.nodeTypes[n.type];
    if (type) out.push({ x: n.x, z: n.z, r: type.radius });
  }
  for (const zone of c.zones) for (const p of zone.props) out.push({ x: p.x, z: p.z, r: p.radius });
  return out;
}

/** Joystick deflection at or below the deadzone counts as released. */
export function isReleased(input: SimInput, c: Content): boolean {
  return Math.hypot(input.x, input.z) <= c.controls.deadzone;
}

function regrow(s: SimState, c: Content, dt: number): void {
  for (const n of s.nodes) {
    if (n.remaining > 0) continue;
    n.regrowLeft -= dt;
    if (n.regrowLeft <= EPS) {
      n.remaining = c.nodeTypes[n.type]?.yield ?? 0;
      n.regrowLeft = 0;
    }
  }
}

function move(s: SimState, input: SimInput, c: Content, dt: number): void {
  const p = s.player;
  const mag = Math.hypot(input.x, input.z);
  const { deadzone, fullSpeedAt } = c.controls;
  if (mag <= deadzone) {
    p.vx = 0;
    p.vz = 0;
    return;
  }
  const speed = c.player.walkSpeed * Math.min(1, (mag - deadzone) / (fullSpeedAt - deadzone));
  p.vx = (input.x / mag) * speed;
  p.vz = (input.z / mag) * speed;
  p.facing = Math.atan2(p.vx, p.vz);
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  const pr = c.player.radius;
  for (const o of obstacles(s, c)) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + pr;
    if (d >= min) continue;
    if (d === 0) {
      p.x = o.x + min;
    } else {
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }
  clampToBounds(s, c);
}

/** Keep the player inside the nearest owned zone. */
function clampToBounds(s: SimState, c: Content): void {
  const p = s.player;
  const r = c.player.radius;
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (const b of ownedZoneBounds(c)) {
    const x = Math.min(Math.max(p.x, b.minX + r), b.maxX - r);
    const z = Math.min(Math.max(p.z, b.minZ + r), b.maxZ - r);
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  }
  if (best) {
    p.x = best.x;
    p.z = best.z;
  }
}

function harvest(s: SimState, c: Content, dt: number, events: SimEvent[]): void {
  const p = s.player;
  const nearest = (): number => {
    let idx = -1;
    let bestD = Infinity;
    s.nodes.forEach((n, i) => {
      const type = c.nodeTypes[n.type];
      if (!type || n.remaining <= 0) return;
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (d <= type.harvestRange && d < bestD) {
        bestD = d;
        idx = i;
      }
    });
    return idx;
  };

  p.harvesting = p.stack.length < c.player.capacity ? nearest() : -1;
  if (p.harvesting < 0) {
    p.swingTimer = 0;
    return;
  }
  p.swingTimer += dt;
  while (p.swingTimer + EPS >= c.player.swingSeconds && p.harvesting >= 0) {
    p.swingTimer -= c.player.swingSeconds;
    const node = s.nodes[p.harvesting];
    const type = node && c.nodeTypes[node.type];
    if (!node || !type) break;
    node.remaining -= 1;
    if (node.remaining <= 0) node.regrowLeft = type.regrowSeconds;
    p.stack.push(type.item);
    events.push({ type: 'harvest', node: p.harvesting, item: type.item });
    p.harvesting = p.stack.length < c.player.capacity ? nearest() : -1;
  }
  if (p.harvesting < 0) p.swingTimer = 0;
}

/** The sell pad whose trigger circle the player is standing in, if any. */
export function sellPadUnderPlayer(s: SimState, c: Content): { x: number; z: number } | null {
  for (const zone of c.zones) {
    for (const pad of zone.pads) {
      if (pad.kind !== 'sell') continue;
      if (Math.hypot(s.player.x - pad.x, s.player.z - pad.z) <= c.interaction.padRadius) return pad;
    }
  }
  return null;
}

function sell(s: SimState, input: SimInput, c: Content, dt: number, events: SimEvent[]): void {
  const p = s.player;
  if (p.stack.length === 0 || !isReleased(input, c) || !sellPadUnderPlayer(s, c)) {
    p.transferTimer = 0;
    return;
  }
  const interval = 1 / c.interaction.transferPerSecond;
  p.transferTimer += dt;
  while (p.transferTimer + EPS >= interval) {
    const item = p.stack.pop();
    if (item === undefined) break;
    p.transferTimer -= interval;
    const price = c.items[item]?.sellPrice ?? 0;
    s.cash += price;
    events.push({ type: 'sell', item, price });
  }
}

export function tick(s: SimState, input: SimInput, c: Content, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  s.time += dt;
  regrow(s, c, dt);
  move(s, input, c, dt);
  harvest(s, c, dt, events);
  sell(s, input, c, dt, events);
  return events;
}
