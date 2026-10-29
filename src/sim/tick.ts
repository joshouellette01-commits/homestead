// One fixed step of the game rules. Every number comes from content.json and
// is read on each call, so live tuning in ?debug takes effect immediately.
import type { Bounds, Content } from '../content';
import {
  buildingPlots,
  builtMachine,
  cycleSeconds,
  inputCapacity,
  inputSource,
  machineInputs,
  materialsDone,
  padUnderPlayer,
  playerStats,
  plotPrice,
  type ActivePad,
} from './plots';
import type { SimInput, SimState } from './state';

/** Fixed simulation step, shared by the game loop and the balance simulator. */
export const SIM_DT = 1 / 60;

/** Absorbs float drift so timers summed from SIM_DT fire on the step they should. */
const EPS = 1e-9;

export type SimEvent =
  | { type: 'harvest'; node: number; item: string }
  | { type: 'sell'; pad: string; item: string; price: number }
  /** An item left the stack into a machine's input pile or a plot's materials. */
  | { type: 'deliver'; pad: string; item: string }
  /** An item came off an output pile onto the stack. */
  | { type: 'collect'; pad: string; item: string }
  | { type: 'purchase'; pad: string; cash: number }
  | { type: 'produce'; building: number };

/** Events caused by the player rather than by machines running on their own. */
export function isPlayerEvent(e: SimEvent): boolean {
  return e.type !== 'produce';
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Zones the player can walk in: free ones and those bought through a gate. */
export function ownedZoneBounds(s: SimState, c: Content): Bounds[] {
  return c.zones.filter((z) => s.zones[z.id]).map((z) => z.bounds);
}

function obstacles(s: SimState, c: Content): Circle[] {
  const out: Circle[] = [];
  for (const n of s.nodes) {
    const type = c.nodeTypes[n.type];
    if (type?.solid) out.push({ x: n.x, z: n.z, r: type.radius });
  }
  for (const zone of c.zones) for (const p of zone.props) out.push({ x: p.x, z: p.z, r: p.radius });
  const plots = buildingPlots(c);
  s.buildings.forEach((b, i) => {
    const plot = plots[i];
    const machine = plot && c.machines[plot.machine];
    if (b.built && plot && machine) out.push({ x: plot.site.x, z: plot.site.z, r: machine.radius });
  });
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
  const speed = playerStats(s, c).walkSpeed * Math.min(1, (mag - deadzone) / (fullSpeedAt - deadzone));
  p.vx = (input.x / mag) * speed;
  p.vz = (input.z / mag) * speed;
  p.facing = Math.atan2(p.vx, p.vz);
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  settle(s, c);
}

/** Push the player out of solids and back inside the owned zones. */
export function settle(s: SimState, c: Content): void {
  const p = s.player;
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
  for (const b of ownedZoneBounds(s, c)) {
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
  const { capacity, swingSeconds } = playerStats(s, c);
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

  p.harvesting = p.stack.length < capacity ? nearest() : -1;
  if (p.harvesting < 0) {
    p.swingTimer = 0;
    return;
  }
  p.swingTimer += dt;
  while (p.swingTimer + EPS >= swingSeconds && p.harvesting >= 0) {
    p.swingTimer -= swingSeconds;
    const node = s.nodes[p.harvesting];
    const type = node && c.nodeTypes[node.type];
    if (!node || !type) break;
    node.remaining -= 1;
    if (node.remaining <= 0) node.regrowLeft = type.regrowSeconds;
    p.stack.push(type.item);
    events.push({ type: 'harvest', node: p.harvesting, item: type.item });
    p.harvesting = p.stack.length < capacity ? nearest() : -1;
  }
  if (p.harvesting < 0) p.swingTimer = 0;
}

/**
 * Built machines make one output per cycle from one of each input, idling
 * while any input is empty or the output pile is full. Animal buildings work
 * the same way, with their feed as the one input and more animals as a
 * shorter cycle.
 */
function runMachines(s: SimState, c: Content, dt: number, events: SimEvent[]): void {
  s.buildings.forEach((_, i) => {
    const m = builtMachine(s, c, i);
    if (!m) return;
    const { b, machine } = m;
    const cycle = cycleSeconds(c, machine, b.level);
    const ready = (): boolean =>
      b.output < machine.pileCapacity && machineInputs(machine).every((item) => (inputSource(s, c, i, item)?.count ?? 0) > 0);
    if (!ready()) {
      b.cycle = 0;
      return;
    }
    b.cycle += dt;
    while (b.cycle + EPS >= cycle && ready()) {
      b.cycle -= cycle;
      for (const item of machineInputs(machine)) inputSource(s, c, i, item)?.take();
      b.output += 1;
      events.push({ type: 'produce', building: i });
    }
  });
}

/** Removes the topmost matching item from the stack, keeping the rest in order. */
function takeFromStack(stack: string[], item: string): void {
  const i = stack.lastIndexOf(item);
  if (i >= 0) stack.splice(i, 1);
}

/** One item's worth of transfer on this pad, or null if nothing can move right now. */
function transferStep(s: SimState, pad: ActivePad, input: SimInput, c: Content): (() => SimEvent) | null {
  const p = s.player;
  switch (pad.kind) {
    case 'sell': {
      // Sell pads unload only while stopped, so walking across sells nothing.
      const top = p.stack[p.stack.length - 1];
      if (top === undefined || !isReleased(input, c)) return null;
      return () => {
        p.stack.pop();
        const price = c.items[top]?.sellPrice ?? 0;
        s.cash += price;
        return { type: 'sell', pad: pad.id, item: top, price };
      };
    }
    case 'input': {
      const m = builtMachine(s, c, pad.building);
      const { item } = pad;
      if (!m || (m.b.inputs[item] ?? 0) >= inputCapacity(m.machine) || !p.stack.includes(item)) return null;
      const { b } = m;
      return () => {
        takeFromStack(p.stack, item);
        b.inputs[item] = (b.inputs[item] ?? 0) + 1;
        return { type: 'deliver', pad: pad.id, item };
      };
    }
    case 'output': {
      const m = builtMachine(s, c, pad.building);
      if (!m || m.b.output <= 0 || p.stack.length >= playerStats(s, c).capacity) return null;
      const { b, machine } = m;
      return () => {
        b.output -= 1;
        p.stack.push(machine.output);
        return { type: 'collect', pad: pad.id, item: machine.output };
      };
    }
    case 'build': {
      const b = s.buildings[pad.building];
      const price = plotPrice(s, c, pad);
      const need = price?.materials.find((m) => m.have < m.need && p.stack.includes(m.item));
      if (!b || !need) return null;
      return () => {
        takeFromStack(p.stack, need.item);
        b.delivered[need.item] = (b.delivered[need.item] ?? 0) + 1;
        return { type: 'deliver', pad: pad.id, item: need.item };
      };
    }
    default:
      return null;
  }
}

function transfer(s: SimState, pad: ActivePad | null, input: SimInput, c: Content, dt: number, events: SimEvent[]): void {
  const p = s.player;
  if (!pad || !transferStep(s, pad, input, c)) {
    p.transferTimer = 0;
    return;
  }
  const interval = 1 / c.interaction.transferPerSecond;
  p.transferTimer += dt;
  while (p.transferTimer + EPS >= interval) {
    const step = transferStep(s, pad, input, c);
    if (!step) break;
    p.transferTimer -= interval;
    events.push(step());
  }
}

/**
 * The purchase ring: fills while the player stands on a plot whose materials
 * are in and whose price they can pay; cash is taken only when it completes.
 */
function purchase(s: SimState, pad: ActivePad | null, c: Content, dt: number, events: SimEvent[]): void {
  const ring = s.purchase;
  if (!pad) ring.locked = false;
  if (ring.pad !== (pad?.id ?? null)) {
    ring.pad = pad?.id ?? null;
    ring.progress = 0;
  }
  const price = pad && !ring.locked ? plotPrice(s, c, pad) : null;
  if (!pad || !price || !materialsDone(price) || s.cash < price.cash) {
    ring.progress = 0;
    return;
  }
  ring.progress += dt;
  if (ring.progress + EPS < c.interaction.purchaseSeconds) return;

  s.cash -= price.cash;
  ring.progress = 0;
  ring.locked = true;
  if (pad.kind === 'character') {
    s.levels[pad.track] += 1;
  } else if (pad.kind === 'gate') {
    s.zones[pad.zone] = true;
  } else if (pad.kind === 'build') {
    const b = s.buildings[pad.building];
    if (b) b.built = true;
    // The new building may overlap where the player stands.
    settle(s, c);
  } else if (pad.kind === 'upgrade') {
    const b = s.buildings[pad.building];
    if (b) b.level += 1;
  }
  events.push({ type: 'purchase', pad: pad.id, cash: price.cash });
}

export function tick(s: SimState, input: SimInput, c: Content, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  s.time += dt;
  regrow(s, c, dt);
  runMachines(s, c, dt, events);
  move(s, input, c, dt);
  harvest(s, c, dt, events);
  const pad = padUnderPlayer(s, c);
  transfer(s, pad, input, c, dt, events);
  purchase(s, pad, c, dt, events);
  return events;
}
