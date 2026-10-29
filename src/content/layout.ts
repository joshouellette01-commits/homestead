// The layout validator: DESIGN.md's four pad rules plus its walking-distance
// rule, checked against content.json at build time. Works on an abstract
// layout so each rule can be tested on its own.
import type { Content } from './schema';

export type LayoutPadKind = 'sell' | 'input' | 'output' | 'trough' | 'plot' | 'upgradePlot' | 'lever';

export interface LayoutPad {
  id: string;
  kind: LayoutPadKind;
  x: number;
  z: number;
}

/**
 * Where goods are picked up and the pads they are carried to. A source can be
 * a pad itself (an output pad, carried to a sell pad); its own pad is never
 * counted as being in the way.
 */
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

/** Two places DESIGN.md says must be within maxWalkDistance of each other. */
export interface LayoutWalk {
  from: { id: string; x: number; z: number };
  to: { id: string; x: number; z: number };
}

export interface Layout {
  padRadius: number;
  playerRadius: number;
  minPadSpacing: number;
  minUpgradePlotToInputPadSpacing: number;
  /** Starting walk speed times maxWalkSeconds. */
  maxWalkDistance: number;
  pads: LayoutPad[];
  piles: LayoutPile[];
  solids: LayoutSolid[];
  walks: LayoutWalk[];
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
  l.pads.forEach((a, i) => {
    for (const b of l.pads.slice(i + 1)) {
      const d = dist(a, b);
      if (d < l.minPadSpacing) errors.push(`pads ${a.id} and ${b.id} are ${f(d)} apart (min ${l.minPadSpacing})`);
    }
  });

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
        if (pad === target || pad.id === pile.id) continue;
        const d = distToSegment(pad, pile, target);
        if (d < l.padRadius) errors.push(`pad ${pad.id} lies on the path from pile ${pile.id} to ${target.id}`);
      }
    }
  }

  // Rule 5: every node within maxWalkSeconds of its machine, and every machine
  // within maxWalkSeconds of its zone's sell pad (straight line, at starting speed).
  for (const w of l.walks) {
    const d = dist(w.from, w.to);
    if (d > l.maxWalkDistance) {
      errors.push(`${w.from.id} is ${f(d)} from ${w.to.id}, more than the ${f(l.maxWalkDistance)} walkable in maxWalkSeconds`);
    }
  }

  return errors;
}

export function layoutFromContent(c: Content): Layout {
  const pads: LayoutPad[] = [];
  const solids: LayoutSolid[] = [];
  const piles: LayoutPile[] = [];
  const walks: LayoutWalk[] = [];
  for (const zone of c.zones) {
    for (const p of zone.pads) pads.push({ id: p.id, kind: p.kind, x: p.x, z: p.z });
    for (const p of zone.props) solids.push({ id: p.id, x: p.x, z: p.z, r: p.radius });
    for (const n of zone.nodes) {
      const type = c.nodeTypes[n.type];
      if (type) solids.push({ id: n.id, x: n.x, z: n.z, r: type.radius });
    }
    const sellPads = zone.pads.filter((p) => p.kind === 'sell');
    for (const plot of zone.plots) {
      if (plot.kind === 'character') {
        pads.push({ id: plot.id, kind: 'upgradePlot', x: plot.x, z: plot.z });
        continue;
      }
      // Checked as if built: the plot pad becomes the speed plot, beside the
      // building and its pads. Before building, only the plot pad exists, so
      // a layout that passes built also passes unbuilt.
      const machine = c.machines[plot.machine];
      const { site } = plot;
      const input = { id: `${plot.id}-input`, kind: 'input' as const, ...site.inputPad };
      const output = { id: `${plot.id}-output`, kind: 'output' as const, ...site.outputPad };
      pads.push({ id: plot.id, kind: 'upgradePlot', x: plot.x, z: plot.z }, input, output);
      if (machine) solids.push({ id: plot.id, x: site.x, z: site.z, r: machine.radius });
      // Trips the player makes: pile to its pad, output pad to each sell pad,
      // and each node that feeds the machine to its input pad.
      piles.push({ id: `${plot.id}-output-pile`, ...site.outputPile, feeds: [output.id] });
      piles.push({ id: `${plot.id}-input-pile`, ...site.inputPile, feeds: [input.id] });
      piles.push({ id: output.id, x: output.x, z: output.z, feeds: sellPads.map((p) => p.id) });
      for (const n of zone.nodes) {
        if (!machine || c.nodeTypes[n.type]?.item !== machine.input) continue;
        piles.push({ id: n.id, x: n.x, z: n.z, feeds: [input.id] });
        walks.push({ from: n, to: input });
      }
      for (const sell of sellPads) walks.push({ from: output, to: sell });
    }
  }
  return {
    padRadius: c.interaction.padRadius,
    playerRadius: c.player.radius,
    minPadSpacing: c.interaction.minPadSpacing,
    minUpgradePlotToInputPadSpacing: c.interaction.minUpgradePlotToInputPadSpacing,
    maxWalkDistance: (c.characterTracks.walkSpeed.values[0] ?? 0) * c.interaction.maxWalkSeconds,
    pads,
    piles,
    solids,
    walks,
  };
}
