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
    for (const input of l.pads.filter((p) => p.kind === 'input' || p.kind === 'trough')) {
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
  /** Input pads by the item they take, with their zone. */
  const inputPads: Array<{ pad: LayoutPad; item: string; zone: string }> = [];
  const outputs: Array<{ pad: LayoutPad; item: string; zone: string }> = [];

  // Buildings are checked as if built: the plot pad becomes the upgrade plot,
  // beside the building and its pads. Before building only the plot pad
  // exists, so a layout that passes built also passes unbuilt.
  for (const zone of c.zones) {
    for (const p of zone.pads) pads.push({ id: p.id, kind: p.kind, x: p.x, z: p.z });
    for (const p of zone.props) solids.push({ id: p.id, x: p.x, z: p.z, r: p.radius });
    for (const n of zone.nodes) {
      const type = c.nodeTypes[n.type];
      if (type?.solid) solids.push({ id: n.id, x: n.x, z: n.z, r: type.radius });
    }
    for (const plot of zone.plots) {
      if (plot.kind === 'character') pads.push({ id: plot.id, kind: 'upgradePlot', x: plot.x, z: plot.z });
      if (plot.kind === 'gate') pads.push({ id: plot.id, kind: 'plot', x: plot.x, z: plot.z });
      if (plot.kind !== 'building') continue;
      const machine = c.machines[plot.machine];
      const { site } = plot;
      pads.push({ id: plot.id, kind: 'upgradePlot', x: plot.x, z: plot.z });
      if (machine) solids.push({ id: plot.id, x: site.x, z: site.z, r: machine.radius });
      for (const [item, where] of Object.entries(site.inputs)) {
        if (!('pad' in where)) continue;
        const pad: LayoutPad = { id: `${plot.id}-input-${item}`, kind: machine?.kind === 'animals' ? 'trough' : 'input', ...where.pad };
        pads.push(pad);
        inputPads.push({ pad, item, zone: zone.id });
        piles.push({ id: `${pad.id}-pile`, ...where.pile, feeds: [pad.id] });
      }
      const output: LayoutPad = { id: `${plot.id}-output`, kind: 'output', ...site.outputPad };
      pads.push(output);
      piles.push({ id: `${output.id}-pile`, ...site.outputPile, feeds: [output.id] });
      if (machine) outputs.push({ pad: output, item: machine.output, zone: zone.id });
    }
  }

  // Trips the player makes. An output pad (a source in its own right) feeds
  // its zone's sell pads and any input pad in the zone that takes its item;
  // each node feeds the input pads that take what it gives. Rule 4 checks
  // trips inside a zone; rule 5 checks distances wherever the trip goes.
  for (const zone of c.zones) {
    const sellPads = zone.pads.filter((p) => p.kind === 'sell');
    for (const out of outputs.filter((o) => o.zone === zone.id)) {
      const downstream = inputPads.filter((i) => i.zone === zone.id && i.item === out.item).map((i) => i.pad.id);
      piles.push({ id: out.pad.id, x: out.pad.x, z: out.pad.z, feeds: [...sellPads.map((p) => p.id), ...downstream] });
      for (const sell of sellPads) walks.push({ from: out.pad, to: sell });
    }
    for (const n of zone.nodes) {
      const item = c.nodeTypes[n.type]?.item;
      const targets = inputPads.filter((i) => i.item === item);
      const sameZone = targets.filter((i) => i.zone === zone.id).map((i) => i.pad.id);
      if (sameZone.length > 0) piles.push({ id: n.id, x: n.x, z: n.z, feeds: sameZone });
      for (const t of targets) walks.push({ from: n, to: t.pad });
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
