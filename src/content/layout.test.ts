import { describe, expect, it } from 'vitest';
import raw from './content.json';
import { layoutFromContent, validateLayout, type Layout } from './layout';
import { parseContent } from './load';

function layout(over: Partial<Layout> = {}): Layout {
  return {
    padRadius: 1,
    playerRadius: 0.4,
    minPadSpacing: 3,
    minUpgradePlotToInputPadSpacing: 3,
    maxWalkDistance: 32,
    pads: [],
    piles: [],
    solids: [],
    walks: [],
    ...over,
  };
}

describe('validateLayout', () => {
  it('passes the shipped content.json', () => {
    expect(validateLayout(layoutFromContent(parseContent(raw)))).toEqual([]);
  });

  it('rule 1: flags a pad radius too large for the spacing', () => {
    expect(validateLayout(layout({ padRadius: 2 }))).toEqual([expect.stringMatching(/trigger areas could overlap/)]);
  });

  it('rule 1: flags a pad whose centre is blocked by a solid', () => {
    const errors = validateLayout(
      layout({ pads: [{ id: 'sell', kind: 'sell', x: 0, z: 0 }], solids: [{ id: 'table', x: 0.5, z: 0, r: 0.5 }] }),
    );
    expect(errors).toEqual([expect.stringMatching(/pad sell cannot be stood on/)]);
  });

  it('rule 2: flags pads closer than minPadSpacing', () => {
    const errors = validateLayout(
      layout({
        pads: [
          { id: 'a', kind: 'sell', x: 0, z: 0 },
          { id: 'b', kind: 'input', x: 2.5, z: 0 },
        ],
      }),
    );
    expect(errors).toEqual([expect.stringMatching(/pads a and b are 2\.50 apart/)]);
  });

  it('rule 3: flags an upgrade plot too close to an input pad, but not to other pads', () => {
    const errors = validateLayout(
      layout({
        minPadSpacing: 2,
        pads: [
          { id: 'up', kind: 'upgradePlot', x: 0, z: 0 },
          { id: 'in', kind: 'input', x: 2.5, z: 0 },
          { id: 'out', kind: 'output', x: -2.5, z: 0 },
        ],
      }),
    );
    expect(errors).toEqual([expect.stringMatching(/upgrade plot up is 2\.50 from input pad in/)]);
  });

  it('rule 4: flags a pad sitting on the path from a pile to the pad it feeds', () => {
    const errors = validateLayout(
      layout({
        pads: [
          { id: 'mill-in', kind: 'input', x: 10, z: 0 },
          { id: 'sell', kind: 'sell', x: 5, z: 0.5 },
        ],
        piles: [{ id: 'wheat', x: 0, z: 0, feeds: ['mill-in'] }],
      }),
    );
    expect(errors).toEqual([expect.stringMatching(/pad sell lies on the path from pile wheat to mill-in/)]);
  });

  it('rule 5: flags a node too far to walk from its machine', () => {
    const errors = validateLayout(
      layout({ walks: [{ from: { id: 'tree', x: 0, z: 0 }, to: { id: 'saw-in', x: 40, z: 0 } }] }),
    );
    expect(errors).toEqual([expect.stringMatching(/tree is 40\.00 from saw-in/)]);
  });

  it('checks a built machine: its building blocks pads too close to it', () => {
    const c = parseContent(raw);
    const plot = c.zones[0]!.plots.find((p) => p.kind === 'building')!;
    if (plot.kind !== 'building') throw new Error('expected a building plot');
    plot.site.inputPad = { x: plot.site.x + 0.5, z: plot.site.z };
    expect(validateLayout(layoutFromContent(c))).toContainEqual(expect.stringMatching(/pad yard-sawmill-input cannot be stood on/));
  });

  it('rule 4: allows a pad beside the path', () => {
    const errors = validateLayout(
      layout({
        pads: [
          { id: 'mill-in', kind: 'input', x: 10, z: 0 },
          { id: 'sell', kind: 'sell', x: 5, z: 1.5 },
        ],
        piles: [{ id: 'wheat', x: 0, z: 0, feeds: ['mill-in'] }],
      }),
    );
    expect(errors).toEqual([]);
  });
});
