import { describe, expect, it } from 'vitest';
import raw from './content.json';
import { ContentError, parseContent } from './load';

const clone = (): Record<string, unknown> => structuredClone(raw) as Record<string, unknown>;

describe('parseContent', () => {
  it('accepts the shipped content.json', () => {
    const c = parseContent(raw);
    expect(c.zones.map((z) => z.id)).toEqual(['yard']);
    expect(c.zones[0]?.nodes).toHaveLength(3);
  });

  it('rejects a missing number with the field path', () => {
    const bad = clone();
    delete (bad.player as Record<string, unknown>).walkSpeed;
    expect(() => parseContent(bad)).toThrow(/player\.walkSpeed/);
  });

  it('rejects a string where a number belongs', () => {
    const bad = clone();
    (bad.camera as Record<string, unknown>).pitchDeg = '35';
    expect(() => parseContent(bad)).toThrow(ContentError);
  });

  it('rejects a node type that names an unknown item', () => {
    const bad = clone();
    (bad.nodeTypes as Record<string, Record<string, unknown>>).tree!.item = 'plank';
    expect(() => parseContent(bad)).toThrow(/unknown item "plank"/);
  });

  it('rejects a node with an unknown type', () => {
    const bad = clone();
    const zones = bad.zones as Array<{ nodes: Array<Record<string, unknown>> }>;
    zones[0]!.nodes[0]!.type = 'oak';
    expect(() => parseContent(bad)).toThrow(/unknown node type "oak"/);
  });
});
