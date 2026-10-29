import { describe, expect, it } from 'vitest';
import { content as c } from '../content';
import { activePads, buildingPlots, cycleSeconds, padUnderPlayer, speedCost, trackValue } from './plots';
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
const capacity0 = trackValue(c, 'capacity', 0);
const walk0 = trackValue(c, 'walkSpeed', 0);
const swing0 = trackValue(c, 'swingSeconds', 0);

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
    expect(s.player.z - c.player.spawn.z).toBeCloseTo(walk0, 1);
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
    const events = run(s, NO_INPUT, swing0 * treeType.yield + 0.01);
    expect(events.filter((e) => e.type === 'harvest')).toHaveLength(treeType.yield);
    expect(s.player.stack).toEqual(Array(treeType.yield).fill(treeType.item));
    expect(s.nodes[0]!.remaining).toBe(0);

    run(s, NO_INPUT, treeType.regrowSeconds + 0.1);
    expect(s.nodes[0]!.remaining).toBe(treeType.yield);
  });

  it('does not swing before swingSeconds have passed', () => {
    const s = besideTree();
    run(s, NO_INPUT, swing0 - 0.05);
    expect(s.player.stack).toHaveLength(0);
  });

  it('stops when the stack is full', () => {
    const s = besideTree();
    s.player.stack = Array(capacity0).fill('log');
    run(s, NO_INPUT, 5);
    expect(s.player.stack).toHaveLength(capacity0);
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

const sawPlot = buildingPlots(c)[0]!;
const saw = c.machines[sawPlot.machine]!;
if (saw.kind !== 'processor') throw new Error('the Sawmill should be a processor');
const sawInput = saw.inputs[0]!;
const sawInputSite = sawPlot.site.inputs[sawInput]!;
if (!('pad' in sawInputSite)) throw new Error('the Sawmill input should have its own pad');
const needLogs = sawPlot.materials.log!;
const ring = c.interaction.purchaseSeconds;

function standOn(s: SimState, at: { x: number; z: number }): SimState {
  s.player.x = at.x;
  s.player.z = at.z;
  return s;
}

function builtSawmill(): SimState {
  const s = createState(c);
  s.buildings[0]!.built = true;
  s.buildings[0]!.delivered = { ...sawPlot.materials };
  return s;
}

describe('building plots', () => {
  it('takes matching materials from the stack and keeps the rest in order', () => {
    const s = standOn(createState(c), sawPlot);
    s.player.stack = ['log', 'plank', 'log'];
    run(s, NO_INPUT, 1);
    expect(s.player.stack).toEqual(['plank']);
    expect(s.buildings[0]!.delivered.log).toBe(2);
  });

  it('keeps delivered materials after the player walks away', () => {
    const s = standOn(createState(c), sawPlot);
    s.player.stack = Array(5).fill('log');
    run(s, NO_INPUT, 1);
    s.player.x += 5;
    run(s, NO_INPUT, 1);
    expect(s.buildings[0]!.delivered.log).toBe(5);
  });

  it('does not start the ring until the materials are in', () => {
    const s = standOn(createState(c), sawPlot);
    s.cash = 1000;
    run(s, NO_INPUT, ring * 2);
    expect(s.buildings[0]!.built).toBe(false);
    expect(s.cash).toBe(1000);
  });

  it('builds when the ring completes and charges the cash then', () => {
    const s = standOn(createState(c), sawPlot);
    s.cash = sawPlot.cash + 5;
    s.buildings[0]!.delivered = { log: needLogs };
    run(s, NO_INPUT, ring - 0.1);
    expect(s.buildings[0]!.built).toBe(false);
    expect(s.cash).toBe(sawPlot.cash + 5);
    run(s, NO_INPUT, 0.2);
    expect(s.buildings[0]!.built).toBe(true);
    expect(s.cash).toBe(5);
  });

  it('charges nothing if the player walks off before the ring fills', () => {
    const s = standOn(createState(c), sawPlot);
    s.cash = sawPlot.cash;
    s.buildings[0]!.delivered = { log: needLogs };
    run(s, NO_INPUT, ring - 0.2);
    s.player.x += 5;
    run(s, NO_INPUT, 0.1);
    standOn(s, sawPlot);
    run(s, NO_INPUT, ring - 0.2);
    expect(s.buildings[0]!.built).toBe(false);
    expect(s.cash).toBe(sawPlot.cash);
  });

  it('does not fill the ring without enough cash', () => {
    const s = standOn(createState(c), sawPlot);
    s.cash = sawPlot.cash - 1;
    s.buildings[0]!.delivered = { log: needLogs };
    run(s, NO_INPUT, ring * 2);
    expect(s.buildings[0]!.built).toBe(false);
  });
});

describe('machines', () => {
  it('turns input into output once per cycle', () => {
    const s = builtSawmill();
    s.buildings[0]!.inputs = { [sawInput]: 5 };
    run(s, NO_INPUT, cycleSeconds(c, saw, 0) * 2 + 0.01);
    expect(s.buildings[0]).toMatchObject({ inputs: { [sawInput]: 3 }, output: 2 });
  });

  it('idles when the output pile is full', () => {
    const s = builtSawmill();
    s.buildings[0]!.inputs = { [sawInput]: 5 };
    s.buildings[0]!.output = saw.pileCapacity;
    run(s, NO_INPUT, saw.cycleSeconds * 3);
    expect(s.buildings[0]).toMatchObject({ inputs: { [sawInput]: 5 }, output: saw.pileCapacity });
  });

  it('input pad takes only the machine input, while walking too, up to the pile capacity', () => {
    const s = standOn(builtSawmill(), sawInputSite.pad);
    s.buildings[0]!.inputs = { [sawInput]: saw.pileCapacity - 2 };
    s.player.stack = ['plank', 'log', 'log', 'log'];
    // Creep so slowly the player stays on the pad, but the joystick is held.
    run(s, { x: c.controls.deadzone + 0.001, z: 0 }, 0.5);
    expect(s.player.stack).toEqual(['plank', 'log']);
    expect(s.buildings[0]!.inputs[sawInput]).toBe(saw.pileCapacity);
  });

  it('output pad loads finished goods onto the stack up to capacity', () => {
    const s = standOn(builtSawmill(), sawPlot.site.outputPad);
    s.buildings[0]!.output = 20;
    s.player.stack = ['log'];
    run(s, NO_INPUT, 3);
    expect(s.player.stack).toHaveLength(capacity0);
    expect(s.player.stack.slice(1).every((i) => i === saw.output)).toBe(true);
    expect(s.buildings[0]!.output).toBe(20 - (capacity0 - 1));
  });

  it('the built machine blocks walking and replaces its plot pad with a speed plot', () => {
    const s = builtSawmill();
    const ids = activePads(s, c).map((p) => p.id);
    expect(ids).toContain(`${sawPlot.id}-upgrade`);
    expect(ids).not.toContain(sawPlot.id);
    standOn(s, sawPlot.site);
    run(s, { x: 0.001, z: 1 }, SIM_DT);
    const d = Math.hypot(s.player.x - sawPlot.site.x, s.player.z - sawPlot.site.z);
    expect(d).toBeGreaterThanOrEqual(saw.radius + c.player.radius - 1e-9);
  });
});

describe('upgrades', () => {
  const capPlot = c.zones[0]!.plots.find((p) => p.kind === 'character' && p.track === 'capacity')!;

  it('a character plot raises its stat one level per visit', () => {
    const cost1 = c.characterTracks.capacity.costs[0]!;
    const s = standOn(createState(c), capPlot);
    s.cash = 100000;
    run(s, NO_INPUT, ring * 3);
    expect(s.levels.capacity).toBe(1);
    expect(s.cash).toBe(100000 - cost1);

    // Step off and back on to buy the next level.
    s.player.x += 5;
    run(s, NO_INPUT, SIM_DT);
    standOn(s, capPlot);
    run(s, NO_INPUT, ring + 0.05);
    expect(s.levels.capacity).toBe(2);
  });

  it('a maxed track has no plot', () => {
    const s = createState(c);
    s.levels.capacity = c.characterTracks.capacity.values.length - 1;
    expect(activePads(s, c).map((p) => p.id)).not.toContain(capPlot.id);
  });

  it('walk speed upgrades make the player faster', () => {
    const s = createState(c);
    s.levels.walkSpeed = 1;
    run(s, { x: 0, z: 1 }, 1);
    expect(s.player.z - c.player.spawn.z).toBeCloseTo(trackValue(c, 'walkSpeed', 1), 1);
  });

  it('speed plot prices follow the income formula and speed up the cycle', () => {
    const perMin = (l: number): number => 60 / cycleSeconds(c, saw, l);
    const price = c.items[saw.output]!.sellPrice;
    expect(speedCost(c, saw, 1)).toBe(Math.round((perMin(1) - perMin(0)) * price * c.buildingSpeed.costMinutes));

    const s = standOn(builtSawmill(), sawPlot);
    s.cash = 100000;
    expect(padUnderPlayer(s, c)?.kind).toBe('upgrade');
    run(s, NO_INPUT, ring + 0.05);
    expect(s.buildings[0]!.level).toBe(1);
    expect(s.cash).toBe(100000 - speedCost(c, saw, 1));
  });

  it('building a plot does not also buy the speed plot that appears under the player', () => {
    const s = standOn(createState(c), sawPlot);
    s.cash = 100000;
    s.buildings[0]!.delivered = { log: needLogs };
    run(s, NO_INPUT, ring * 3);
    expect(s.buildings[0]).toMatchObject({ built: true, level: 0 });
  });
});
