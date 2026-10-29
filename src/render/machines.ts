// Building meshes from primitives, per DESIGN.md (no pack has these). Each is
// built to a footprint sized from the machine's collision radius, faces +z,
// and may have a part that spins while the machine runs.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, ITEM_COLORS } from './config';

export interface MachineMesh {
  root: Group;
  /** Spins around its own y axis while the machine runs; null if nothing spins. */
  spinner: Mesh | Group | null;
  /** Every material, so the building can fade as one. */
  materials: MeshLambertMaterial[];
}

/**
 * Merges every mesh under root (outside keep) into a single mesh, its colours
 * painted per vertex, so a model built from many boxes is one draw call.
 * Root must sit at the origin. Returns the materials still in use.
 */
export function mergeByColor(root: Group, keep: Object3D | null = null): MeshLambertMaterial[] {
  const inKeep = (o: Object3D): boolean => {
    for (let p: Object3D | null = o; p; p = p.parent) if (p === keep) return true;
    return false;
  };
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  const merged: Mesh[] = [];
  const color = new Color();
  let transparent = false;
  root.traverse((o) => {
    if (!(o instanceof Mesh) || inKeep(o) || !(o.material instanceof MeshLambertMaterial)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    color.copy(o.material.color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    parts.push(g);
    merged.push(o);
    transparent ||= o.material.transparent;
  });
  for (const o of merged) o.removeFromParent();
  const geometry = parts.length > 0 ? mergeGeometries(parts) : null;
  if (!geometry) return [];
  const material = new MeshLambertMaterial({ vertexColors: true, transparent });
  root.add(new Mesh(geometry, material));
  return [material];
}

class Builder {
  readonly root = new Group();
  readonly materials: MeshLambertMaterial[] = [];

  mat(color: number): MeshLambertMaterial {
    const m = new MeshLambertMaterial({ color, transparent: true });
    this.materials.push(m);
    return m;
  }

  mesh(geometry: BufferGeometry, color: number, x: number, y: number, z: number, parent: Group = this.root): Mesh {
    const m = new Mesh(geometry, this.mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent?: Group): Mesh {
    return this.mesh(new BoxGeometry(w, h, d), color, x, y, z, parent);
  }

  /** A pitched roof: a triangular prism running along x, w long, h tall, d deep, its eaves at height y. */
  roof(w: number, h: number, d: number, color: number, x: number, y: number, z: number): Mesh {
    // A 3-sided cylinder is a prism; turn it so the ridge runs along x and points up.
    const g = new CylinderGeometry(1, 1, w, 3);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 2);
    g.translate(0, 0.5, 0);
    g.scale(1, h / 1.5, d / Math.sqrt(3));
    return this.mesh(g, color, x, y, z);
  }

  /**
   * Merges every piece outside the spinner into one mesh per colour, so a
   * building costs a few draw calls rather than one per box.
   */
  done(spinner: Mesh | Group | null): MachineMesh {
    const materials = mergeByColor(this.root, spinner);
    spinner?.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshLambertMaterial && !materials.includes(o.material)) materials.push(o.material);
    });
    this.root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return { root: this.root, spinner, materials };
  }
}

/** The Sawmill: a plank platform, a small shed and a saw bench. */
function sawmill(width: number, depth: number): MachineMesh {
  const b = new Builder();
  b.box(width, 0.25, depth, COLORS.sawmillBase, 0, 0.125, 0);
  b.box(1.0, 1.1, depth * 0.85, COLORS.sawmillWall, -width / 2 + 0.6, 0.8, -0.05);
  b.roof(1.25, 0.5, depth * 0.95, COLORS.sawmillRoof, -width / 2 + 0.6, 1.35, -0.05);
  b.box(1.1, 0.5, 0.7, COLORS.sawmillWall, width / 2 - 0.65, 0.5, 0.1);
  const log = b.mesh(new CylinderGeometry(0.13, 0.13, 0.9, 8), ITEM_COLORS.log ?? COLORS.unknownItem, width / 2 - 0.65, 0.88, 0.25);
  log.rotation.z = Math.PI / 2;
  const blade = b.mesh(new CylinderGeometry(0.32, 0.32, 0.03, 16), COLORS.tool, width / 2 - 0.65, 0.85, -0.05);
  blade.rotation.x = Math.PI / 2;
  return b.done(blade);
}

/** The Mill: a stone tower with a cone roof and four sails on the front. */
function mill(width: number, depth: number): MachineMesh {
  const b = new Builder();
  const r = Math.min(width, depth) * 0.36;
  b.mesh(new CylinderGeometry(r * 0.85, r, 2.0, 10), COLORS.millStone, 0, 1.0, 0);
  b.mesh(new ConeGeometry(r * 1.05, 0.9, 10), COLORS.millRoof, 0, 2.45, 0);
  b.box(0.45, 0.7, 0.1, COLORS.sawmillBase, 0, 0.35, r * 0.95);
  // Sails turn about an axle pointing out of the front.
  const hub = new Group();
  hub.position.set(0, 1.85, r + 0.12);
  hub.rotation.x = Math.PI / 2;
  b.root.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new Group();
    arm.rotation.y = (i * Math.PI) / 2;
    hub.add(arm);
    b.box(0.08, 0.04, 1.2, COLORS.sawmillBase, 0, 0, 0.6, arm);
    b.box(0.32, 0.02, 0.9, COLORS.millSail, 0.18, 0, 0.7, arm);
  }
  return b.done(hub);
}

/** The Bakery: a cottage with a chimney and an oven by the door. */
function bakery(width: number, depth: number): MachineMesh {
  const b = new Builder();
  b.box(width * 0.9, 1.1, depth * 0.85, COLORS.bakeryWall, 0, 0.55, -0.05);
  b.roof(width * 0.95, 0.6, depth * 0.95, COLORS.bakeryRoof, 0, 1.1, -0.05);
  b.box(0.3, 0.8, 0.3, COLORS.millStone, width * 0.25, 1.65, -depth * 0.15);
  b.box(0.4, 0.65, 0.08, COLORS.sawmillBase, -width * 0.15, 0.33, depth * 0.38);
  // Oven glow beside the door.
  b.box(0.45, 0.35, 0.08, COLORS.ovenGlow, width * 0.2, 0.45, depth * 0.38);
  return b.done(null);
}

/** The Coop: a fenced pen with a little hut at the back. The hens are drawn separately. */
function coop(width: number, depth: number): MachineMesh {
  const b = new Builder();
  // Hut at the back of the pen.
  b.box(width * 0.45, 0.8, depth * 0.35, COLORS.coopWall, -width * 0.2, 0.55, -depth * 0.3);
  b.roof(width * 0.5, 0.4, depth * 0.42, COLORS.sawmillRoof, -width * 0.2, 0.95, -depth * 0.3);
  b.box(width * 0.45, 0.15, depth * 0.35, COLORS.sawmillBase, -width * 0.2, 0.08, -depth * 0.3);
  // Pen: posts round the edge with a rail on top.
  const posts = 14;
  const rx = width / 2;
  const rz = depth / 2;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    b.box(0.08, 0.5, 0.08, COLORS.sawmillBase, Math.cos(a) * rx, 0.25, Math.sin(a) * rz);
    const a2 = ((i + 1) / posts) * Math.PI * 2;
    const x0 = Math.cos(a) * rx;
    const z0 = Math.sin(a) * rz;
    const x1 = Math.cos(a2) * rx;
    const z1 = Math.sin(a2) * rz;
    const rail = b.box(Math.hypot(x1 - x0, z1 - z0), 0.05, 0.05, COLORS.sawmillWall, (x0 + x1) / 2, 0.42, (z0 + z1) / 2);
    rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  }
  return b.done(null);
}

/** The Patisserie: a pink shop with a striped awning. */
function patisserie(width: number, depth: number): MachineMesh {
  const b = new Builder();
  b.box(width * 0.85, 1.2, depth * 0.8, COLORS.patisserieWall, 0, 0.6, -0.08);
  b.roof(width * 0.9, 0.45, depth * 0.9, COLORS.bakeryRoof, 0, 1.2, -0.08);
  const stripes = 6;
  const sw = (width * 0.85) / stripes;
  for (let i = 0; i < stripes; i++) {
    const s = b.box(sw, 0.05, 0.45, i % 2 === 0 ? COLORS.awningA : COLORS.awningB, -width * 0.425 + sw * (i + 0.5), 0.95, depth * 0.45);
    s.rotation.x = 0.35;
  }
  b.box(0.4, 0.65, 0.08, COLORS.sawmillBase, 0, 0.33, depth * 0.33);
  return b.done(null);
}

/** Meshes per machine id. */
export const MACHINE_MESHES: Record<string, (width: number, depth: number) => MachineMesh> = {
  sawmill,
  mill,
  bakery,
  coop,
  patisserie,
};

/** A plain shed for any machine without a mesh of its own yet. */
export function fallbackMesh(width: number, depth: number): MachineMesh {
  const b = new Builder();
  b.box(width * 0.9, 1.0, depth * 0.85, COLORS.sawmillWall, 0, 0.5, 0);
  b.roof(width * 0.95, 0.5, depth * 0.95, COLORS.sawmillRoof, 0, 1.0, 0);
  return b.done(null);
}
