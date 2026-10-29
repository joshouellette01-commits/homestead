// Zone fences, gates and the tint over zones not yet bought. Every zone is
// fenced; an edge between two owned zones opens up. A locked zone's edge
// with the zone its gate stands in shows the gate.
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, type Scene } from 'three';
import type { Bounds, Content } from '../content';
import type { SimState } from '../sim/state';
import { COLORS, FENCES, MODEL_COLORS } from './config';
import type { Model, Models } from './models';

interface Segment {
  x: number;
  z: number;
  /** Yaw: 0 runs along x, PI/2 along z. */
  yaw: number;
}

interface Edge {
  zone: string;
  /** The other zone sharing this edge, if any. */
  neighbour: string | null;
  from: { x: number; z: number };
  to: { x: number; z: number };
}

function edges(c: Content): Edge[] {
  const out: Edge[] = [];
  const touches = (a: Bounds, b: Bounds, fixed: 'x' | 'z', at: number): boolean => {
    if (fixed === 'x') return (b.minX === at || b.maxX === at) && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0;
    return (b.minZ === at || b.maxZ === at) && Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0;
  };
  for (const zone of c.zones) {
    const b = zone.bounds;
    const sides: Array<{ fixed: 'x' | 'z'; at: number; from: { x: number; z: number }; to: { x: number; z: number } }> = [
      { fixed: 'z', at: b.minZ, from: { x: b.minX, z: b.minZ }, to: { x: b.maxX, z: b.minZ } },
      { fixed: 'z', at: b.maxZ, from: { x: b.minX, z: b.maxZ }, to: { x: b.maxX, z: b.maxZ } },
      { fixed: 'x', at: b.minX, from: { x: b.minX, z: b.minZ }, to: { x: b.minX, z: b.maxZ } },
      { fixed: 'x', at: b.maxX, from: { x: b.maxX, z: b.minZ }, to: { x: b.maxX, z: b.maxZ } },
    ];
    for (const side of sides) {
      const other = c.zones.find((o) => o !== zone && touches(b, o.bounds, side.fixed, side.at));
      // Draw shared edges once, from the zone listed first.
      if (other && c.zones.indexOf(other) < c.zones.indexOf(zone)) continue;
      out.push({ zone: zone.id, neighbour: other?.id ?? null, from: side.from, to: side.to });
    }
  }
  return out;
}

function instanced(scene: Scene, model: Model, count: number): InstancedMesh[] {
  return model.parts.map((p) => {
    const m = new InstancedMesh(p.geometry, new MeshLambertMaterial({ color: MODEL_COLORS[p.material] ?? COLORS.unknownItem }), count);
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    scene.add(m);
    return m;
  });
}

export class ZonesView {
  private readonly edges: Edge[];
  private readonly fence: InstancedMesh[];
  private readonly gates: InstancedMesh[];
  private readonly tints = new Map<string, Mesh>();
  private readonly dummy = new Object3D();
  private lastOwned = '';

  constructor(
    scene: Scene,
    private readonly content: Content,
    models: Models,
  ) {
    this.edges = edges(content);
    const length = this.edges.reduce((n, e) => n + Math.hypot(e.to.x - e.from.x, e.to.z - e.from.z), 0);
    this.fence = instanced(scene, models.fence, Math.ceil(length / FENCES.segment) + 1);
    this.gates = instanced(scene, models.gate, Math.max(1, content.zones.length));
    const tintMat = new MeshBasicMaterial({ color: COLORS.lockedZone, transparent: true, opacity: FENCES.lockedTint, depthWrite: false });
    for (const zone of content.zones) {
      const b = zone.bounds;
      const tint = new Mesh(new PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ), tintMat);
      tint.rotation.x = -Math.PI / 2;
      tint.position.set((b.minX + b.maxX) / 2, 0.005, (b.minZ + b.maxZ) / 2);
      scene.add(tint);
      this.tints.set(zone.id, tint);
    }
  }

  /** Where each locked zone's gate sits on its fence: the edge point nearest its gate plot. */
  private gateSpots(s: SimState): Array<Segment & { zone: string }> {
    const spots: Array<Segment & { zone: string }> = [];
    for (const zone of this.content.zones) {
      for (const p of zone.plots) {
        if (p.kind !== 'gate' || s.zones[p.zone]) continue;
        const target = this.content.zones.find((z) => z.id === p.zone);
        if (!target) continue;
        const b = target.bounds;
        // Snap the plot onto the nearest side of the zone it opens.
        const cx = Math.min(Math.max(p.x, b.minX), b.maxX);
        const cz = Math.min(Math.max(p.z, b.minZ), b.maxZ);
        const sides = [
          { x: cx, z: b.minZ, yaw: 0, d: Math.abs(p.z - b.minZ) },
          { x: cx, z: b.maxZ, yaw: 0, d: Math.abs(p.z - b.maxZ) },
          { x: b.minX, z: cz, yaw: Math.PI / 2, d: Math.abs(p.x - b.minX) },
          { x: b.maxX, z: cz, yaw: Math.PI / 2, d: Math.abs(p.x - b.maxX) },
        ].sort((a, b2) => a.d - b2.d);
        const best = sides[0];
        if (best) spots.push({ x: best.x, z: best.z, yaw: best.yaw, zone: p.zone });
      }
    }
    return spots;
  }

  update(s: SimState): void {
    const owned = this.content.zones.map((z) => (s.zones[z.id] ? '1' : '0')).join('');
    if (owned === this.lastOwned) return;
    this.lastOwned = owned;

    for (const [id, tint] of this.tints) tint.visible = !s.zones[id];
    const gates = this.gateSpots(s);
    const d = this.dummy;
    const matrix = new Matrix4();
    let n = 0;
    for (const e of this.edges) {
      // An edge between two owned zones is open ground.
      if (e.neighbour && s.zones[e.zone] && s.zones[e.neighbour]) continue;
      const len = Math.hypot(e.to.x - e.from.x, e.to.z - e.from.z);
      const yaw = e.from.x === e.to.x ? Math.PI / 2 : 0;
      const count = Math.round(len / FENCES.segment);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = e.from.x + (e.to.x - e.from.x) * t;
        const z = e.from.z + (e.to.z - e.from.z) * t;
        // Leave a gap where a gate stands.
        if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < FENCES.gateWidth / 2)) continue;
        d.position.set(x, 0, z);
        d.rotation.set(0, yaw, 0);
        d.scale.set(FENCES.segment, FENCES.height, 1);
        d.updateMatrix();
        for (const m of this.fence) m.setMatrixAt(n, d.matrix);
        n++;
      }
    }
    for (const m of this.fence) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null;
    }
    gates.forEach((g, i) => {
      d.position.set(g.x, 0, g.z);
      d.rotation.set(0, g.yaw, 0);
      d.scale.set(FENCES.gateWidth, FENCES.height, 1);
      d.updateMatrix();
      matrix.copy(d.matrix);
      for (const m of this.gates) m.setMatrixAt(i, matrix);
    });
    for (const m of this.gates) {
      m.count = gates.length;
      m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null;
    }
  }
}
