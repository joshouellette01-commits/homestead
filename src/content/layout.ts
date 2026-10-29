// The layout validator: DESIGN.md's four pad rules, checked against
// content.json at build time. Works on an abstract layout so the rules can be
// tested before machines, piles and plots exist in content.
import type { Content } from './schema';

export type LayoutPadKind = 'sell' | 'input' | 'output' | 'trough' | 'plot' | 'upgradePlot' | 'lever';

export interface LayoutPad {
  id: string;
  kind: LayoutPadKind;
  x: number;
  z: number;
}

/** A pile of goods and the pads it is carried to. */
export interface LayoutPile {
  id: string;
  x: number;
  z: number;
  feeds: string[];
}

/** Something the player cannot walk through. */
export interface LayoutSolid {
  id: string;
  x: number;
  z: number;
  r: number;
}

export interface Layout {
  padRadius: number;
  playerRadius: number;
  minPadSpacing: number;
  minUpgradePlotToInputPadSpacing: number;
  pads: LayoutPad[];
  piles: LayoutPile[];
  solids: LayoutSolid[];
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Shortest distance from point p to the segment a-b. */
function distToSegment(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.z - (a.z + t * abz));
}

export function validateLayout(l: Layout): string[] {
  const errors: string[] = [];
  const f = (n: number): string => n.toFixed(2);

  // Rule 1: a pad triggers within padRadius of its centre, so the player must
  // be able to stand on that centre, and trigger circles must not overlap.
  if (l.padRadius * 2 > l.minPadSpacing) {
    errors.push(`padRadius ${l.padRadius} is more than half of minPadSpacing ${l.minPadSpacing}; trigger areas could overlap`);
  }
  for (const pad of l.pads) {
    for (const s of l.solids) {
      const d = dist(pad, s);
      if (d < s.r + l.playerRadius) {
        errors.push(`pad ${pad.id} cannot be stood on: ${s.id} is ${f(d)} from its centre (needs ${f(s.r + l.playerRadius)})`);
      }
    }
  }

  // Rule 2: pads sit at least minPadSpacing apart.
  for (let i = 0; i < l.pads.length; i++) {
    for (let j = i + 1; j < l.pads.length; j++) {
      const a = l.pads[i]!;
      const b = l.pads[j]!;
      const d = dist(a, b);
      if (d < l.minPadSpacing) errors.push(`pads ${a.id} and ${b.id} are ${f(d)} apart (min ${l.minPadSpacing})`);
    }
  }

  // Rule 3: upgrade plots sit at least minUpgradePlotToInputPadSpacing from any input pad.
  for (const plot of l.pads.filter((p) => p.kind === 'upgradePlot')) {
    for (const input of l.pads.filter((p) => p.kind === 'input')) {
      const d = dist(plot, input);
      if (d < l.minUpgradePlotToInputPadSpacing) {
        errors.push(`upgrade plot ${plot.id} is ${f(d)} from input pad ${input.id} (min ${l.minUpgradePlotToInputPadSpacing})`);
      }
    }
  }

  // Rule 4: no pad lies on the straight path between a pile and a pad it feeds.
  const byId = new Map(l.pads.map((p) => [p.id, p]));
  for (const pile of l.piles) {
    for (const targetId of pile.feeds) {
      const target = byId.get(targetId);
      if (!target) {
        errors.push(`pile ${pile.id} feeds unknown pad ${targetId}`);
        continue;
      }
      for (const pad of l.pads) {
        if (pad === target) continue;
        const d = distToSegment(pad, pile, target);
        if (d < l.padRadius) errors.push(`pad ${pad.id} lies on the path from pile ${pile.id} to ${target.id}`);
      }
    }
  }

  return errors;
}

export function layoutFromContent(c: Content): Layout {
  const pads: LayoutPad[] = [];
  const solids: LayoutSolid[] = [];
  for (const zone of c.zones) {
    for (const p of zone.pads) pads.push({ id: p.id, kind: p.kind, x: p.x, z: p.z });
    for (const p of zone.props) solids.push({ id: p.id, x: p.x, z: p.z, r: p.radius });
    for (const n of zone.nodes) {
      const type = c.nodeTypes[n.type];
      if (type) solids.push({ id: n.id, x: n.x, z: n.z, r: type.radius });
    }
  }
  return {
    padRadius: c.interaction.padRadius,
    playerRadius: c.player.radius,
    minPadSpacing: c.interaction.minPadSpacing,
    minUpgradePlotToInputPadSpacing: c.interaction.minUpgradePlotToInputPadSpacing,
    pads,
    piles: [],
    solids,
  };
}
