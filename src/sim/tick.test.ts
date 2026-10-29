import { describe, expect, it } from 'vitest';
import { content as c } from '../content';
import { NO_INPUT, createState, type SimInput, type SimState } from './state';
import { SIM_DT, tick, type SimEvent } from './tick';

function run(s: SimState, input: SimInput, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) events.push(...tick(s, input, c, SIM_DT));
  return events;
}

const tree = c.zones[0]!.nodes[0]!;
const treeType = c.nodeTypes[tree.type]!;
const sellPad = c.zones[0]!.pads[0]!;
const logPrice = c.items.log!.sellPrice;

/** A state with the player standing just inside harvest range of the first tree, on its +x side. */
function besideTree(): SimState {
  const s = createState(c);
  s.player.x = tree.x + treeType.radius + c.player.radius + 0.05;
  s.player.z = tree.z;
  return s;
}

function onSellPad(stack: string[]): SimState {
  const s = createState(c);
  s.player.x = sellPad.x;
  s.player.z = sellPad.z;
  s.player.stack = [...stack];
  return s;
}

describe('movement', () => {
  it('walks at walkSpeed with the joystick fully deflected', () => {
    const s = createState(c);
    run(s, { x: 0, z: 1 }, 1);
    expect(s.player.z - c.player.spawn.z).toBeCloseTo(c.player.walkSpeed, 1);
  });

  it('does not move inside the deadzone', () => {
    const s = createState(c);
    run(s, { x: c.controls.deadzone * 0.5, z: 0 }, 1);
    expect(s.player.x).toBe(c.player.spawn.x);
  });

  it('cannot walk through a tree', () => {
    const s = besideTree();
    run(s, { x: -1, z: 0 }, 2);
    const d = Math.hypot(s.player.x - tree.x, s.player.z - tree.z);
    expect(d).toBeGreaterThanOrEqual(treeType.radius + c.player.radius - 1e-9);
  });

  it('stays inside the Yard', () => {
    const s = createState(c);
    run(s, { x: 1, z: 0 }, 20);
    expect(s.player.x).toBeCloseTo(c.zones[0]!.bounds.maxX - c.player.radius);
  });
});

describe('harvesting', () => {
  it('adds one item per swing until the tree is empty, then it regrows', () => {
    const s = besideTree();
    const events = run(s, NO_INPUT, c.player.swingSeconds * treeType.yield + 0.01);
    expect(events.filter((e) => e.type === 'harvest')).toHaveLength(treeType.yield);
    expect(s.player.stack).toEqual(Array(treeType.yield).fill(treeType.item));
    expect(s.nodes[0]!.remaining).toBe(0);

    run(s, NO_INPUT, treeType.regrowSeconds + 0.1);
    expect(s.nodes[0]!.remaining).toBe(treeType.yield);
  });

  it('does not swing before swingSeconds have passed', () => {
    const s = besideTree();
    run(s, NO_INPUT, c.player.swingSeconds - 0.05);
    expect(s.player.stack).toHaveLength(0);
  });

  it('stops when the stack is full', () => {
    const s = besideTree();
    s.player.stack = Array(c.player.capacity).fill('log');
    run(s, NO_INPUT, 5);
    expect(s.player.stack).toHaveLength(c.player.capacity);
    expect(s.nodes[0]!.remaining).toBe(treeType.yield);
  });
});

describe('selling', () => {
  it('sells at transferPerSecond while standing still on the pad', () => {
    const s = onSellPad(Array(10).fill('log'));
    run(s, NO_INPUT, 1 / c.interaction.transferPerSecond * 5 + 0.001);
    expect(s.player.stack).toHaveLength(5);
    expect(s.cash).toBe(5 * logPrice);
  });

  it('sells nothing while the joystick is held', () => {
    const s = onSellPad(Array(10).fill('log'));
    // Walk slowly across the pad: still inside it after a short time.
    run(s, { x: c.controls.deadzone + 0.01, z: 0 }, 0.3);
    expect(s.player.stack).toHaveLength(10);
    expect(s.cash).toBe(0);
  });

  it('unloads from the top of the stack first', () => {
    const s = onSellPad(['a', 'b', 'log']);
    const events = run(s, NO_INPUT, 1 / c.interaction.transferPerSecond + 0.001);
    expect(events[0]).toMatchObject({ type: 'sell', item: 'log' });
    expect(s.player.stack).toEqual(['a', 'b']);
  });

  it('sells nothing off the pad', () => {
    const s = onSellPad(['log']);
    s.player.x += c.interaction.padRadius + 0.5;
    run(s, NO_INPUT, 1);
    expect(s.player.stack).toHaveLength(1);
  });
});
