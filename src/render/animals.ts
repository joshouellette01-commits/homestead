// Hens in their pen: a random walk inside the pen with the odd peck, per
// DESIGN.md. One per animal the building has, appearing once it is built.
// All hens share two instanced meshes (bodies, and heads that peck), coloured
// per vertex, so a full coop costs two draw calls.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Content } from '../content';
import { animalCount, buildingPlots, upgradeLevels } from '../sim/plots';
import type { SimState } from '../sim/state';
import { HENS, COLORS } from './config';

interface Hen {
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Seconds left standing still (pecking) before picking a new spot. */
  wait: number;
  heading: number;
}

/** Paints a geometry one colour, as a vertex colour attribute. */
function painted(g: BufferGeometry, color: number): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new Color(color);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geo;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('could not build the hen');
  return g;
}

/** Body and tail, around the hen's feet. */
function bodyGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.16, 8, 6);
  body.scale(0.9, 0.85, 1.2);
  body.translate(0, 0.2, 0);
  const tail = new ConeGeometry(0.08, 0.16, 5);
  tail.rotateX(-0.8);
  tail.translate(0, 0.3, -0.17);
  return merged([painted(body, COLORS.henBody), painted(tail, COLORS.henBody)]);
}

/** Head, beak and comb, around the neck joint so it can dip to peck. */
function headGeometry(): BufferGeometry {
  const skull = new SphereGeometry(0.08, 8, 6);
  const beak = new ConeGeometry(0.03, 0.07, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, -0.01, 0.09);
  const comb = new BoxGeometry(0.03, 0.05, 0.08);
  comb.translate(0, 0.08, 0);
  return merged([painted(skull, COLORS.henBody), painted(beak, COLORS.henBeak), painted(comb, COLORS.henComb)]);
}

/** Where the head joins the body, in the hen's frame. */
const NECK = { y: 0.34, z: 0.14 } as const;

export class AnimalsView {
  private readonly pens: Array<{ building: number; x: number; z: number; rx: number; rz: number; yaw: number; hens: Hen[] }> = [];
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly neck = new Matrix4();
  private readonly headLocal = new Object3D();

  constructor(
    scene: Scene,
    private readonly content: Content,
  ) {
    let max = 0;
    buildingPlots(content).forEach((plot, building) => {
      const machine = content.machines[plot.machine];
      if (machine?.kind !== 'animals') return;
      const r = machine.radius;
      max += animalCount(machine, upgradeLevels(content, machine));
      this.pens.push({ building, x: plot.site.x, z: plot.site.z, rx: r * HENS.penWidth, rz: r * HENS.penDepth, yaw: 0, hens: [] });
    });
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.bodies = new InstancedMesh(bodyGeometry(), material, Math.max(1, max));
    this.heads = new InstancedMesh(headGeometry(), material, Math.max(1, max));
    for (const m of [this.bodies, this.heads]) {
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
    }
  }
  /** The pen's facing comes from the building view, so hens stay clear of the hut at the back. */
  setFacing(building: number, yaw: number): void {
    const pen = this.pens.find((p) => p.building === building);
    if (pen) pen.yaw = yaw;
  }

  private pickSpot(pen: (typeof this.pens)[number], hen: Hen): void {
    // A random point in the front part of the pen (local +z), away from the hut.
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    const lx = Math.cos(a) * r * pen.rx;
    const lz = HENS.frontOffset + Math.abs(Math.sin(a)) * r * pen.rz;
    const cos = Math.cos(pen.yaw);
    const sin = Math.sin(pen.yaw);
    hen.tx = pen.x + lx * cos + lz * sin;
    hen.tz = pen.z - lx * sin + lz * cos;
  }

  update(s: SimState, dt: number): void {
    let n = 0;
    for (const pen of this.pens) {
      const b = s.buildings[pen.building];
      const machine = this.content.machines[buildingPlots(this.content)[pen.building]?.machine ?? ''];
      const want = b?.built && machine ? animalCount(machine, b.level) : 0;
      while (pen.hens.length < want) {
        const hen: Hen = { x: pen.x, z: pen.z, tx: pen.x, tz: pen.z, wait: Math.random(), heading: 0 };
        this.pickSpot(pen, hen);
        hen.x = hen.tx;
        hen.z = hen.tz;
        pen.hens.push(hen);
      }
      pen.hens.length = Math.min(pen.hens.length, want);
      for (const hen of pen.hens) {
        const dx = hen.tx - hen.x;
        const dz = hen.tz - hen.z;
        const dist = Math.hypot(dx, dz);
        let peck = 0;
        if (hen.wait > 0) {
          hen.wait -= dt;
          // Dip the head now and then while standing.
          peck = Math.max(0, Math.sin(hen.wait * HENS.peckSpeed)) * HENS.peckAngle;
          if (hen.wait <= 0) this.pickSpot(pen, hen);
        } else if (dist < 0.05) {
          hen.wait = HENS.waitMin + Math.random() * HENS.waitSpread;
        } else {
          const step = Math.min(dist, HENS.speed * dt);
          hen.x += (dx / dist) * step;
          hen.z += (dz / dist) * step;
          hen.heading = Math.atan2(dx, dz);
        }
        const d = this.dummy;
        d.position.set(hen.x, 0, hen.z);
        d.rotation.set(0, hen.heading, 0);
        d.updateMatrix();
        this.bodies.setMatrixAt(n, d.matrix);
        const h = this.headLocal;
        h.position.set(0, NECK.y, NECK.z);
        h.rotation.set(peck, 0, 0);
        h.updateMatrix();
        this.heads.setMatrixAt(n, this.neck.multiplyMatrices(d.matrix, h.matrix));
        n++;
      }
    }
    for (const m of [this.bodies, this.heads]) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null;
    }
  }
}
