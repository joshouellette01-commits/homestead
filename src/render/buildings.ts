// Machines: the building itself (from primitives, per DESIGN.md), a faint
// footprint before it is built, its input and output pads, and the piles
// beside them. Buildings between the camera and the farmer fade.
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { BuildingPlotContent, Content, MachineContent, Vec2 } from '../content';
import { buildingPlots, cycleSeconds } from '../sim/plots';
import type { SimState } from '../sim/state';
import { BUILDINGS, COLORS, ITEM_COLORS, PILE } from './config';
import { ItemInstances } from './items';
import type { Models } from './models';

interface BuildingView {
  plot: BuildingPlotContent;
  root: Group;
  /** Spins while the machine is running. */
  blade: Mesh;
  ghost: Mesh;
  materials: MeshLambertMaterial[];
  pads: Array<{ x: number; z: number; material: MeshLambertMaterial; ring: Mesh; icon: Mesh }>;
  built: boolean;
  /** Items still flying into each pile; hidden until they land. */
  incoming: { input: number; output: number };
  /** Seconds since it was built, for the pop-in; Infinity once settled. */
  sinceBuilt: number;
  opacity: number;
}

interface MachineMesh {
  root: Group;
  /** Spins while the machine runs. */
  blade: Mesh;
  materials: MeshLambertMaterial[];
}

/** The Sawmill: a plank platform, a small shed and a saw bench. Front faces +z. */
function sawmill(width: number, depth: number): MachineMesh {
  const materials: MeshLambertMaterial[] = [];
  const mat = (color: number): MeshLambertMaterial => {
    const m = new MeshLambertMaterial({ color, transparent: true });
    materials.push(m);
    return m;
  };
  const root = new Group();
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): Mesh => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  box(width, 0.25, depth, COLORS.sawmillBase, 0, 0.125, 0);
  // Shed on the left half.
  box(1.0, 1.1, depth * 0.85, COLORS.sawmillWall, -width / 2 + 0.6, 0.8, -0.05);
  const roof = new Mesh(new CylinderGeometry(0.75, 0.75, depth * 0.95, 3), mat(COLORS.sawmillRoof));
  roof.rotation.x = Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  roof.scale.set(0.8, 1, 1);
  roof.position.set(-width / 2 + 0.6, 1.55, -0.05);
  root.add(roof);
  // Saw bench on the right half, with a log on it and the blade through it.
  box(1.1, 0.5, 0.7, COLORS.sawmillWall, width / 2 - 0.65, 0.5, 0.1);
  const log = new Mesh(new CylinderGeometry(0.13, 0.13, 0.9, 8), mat(ITEM_COLORS.log ?? COLORS.unknownItem));
  log.rotation.z = Math.PI / 2;
  log.position.set(width / 2 - 0.65, 0.88, 0.25);
  root.add(log);
  const blade = new Mesh(new CylinderGeometry(0.32, 0.32, 0.03, 16), mat(COLORS.tool));
  blade.rotation.x = Math.PI / 2;
  blade.position.set(width / 2 - 0.65, 0.85, -0.05);
  root.add(blade);
  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { root, blade, materials };
}

/** Meshes per machine id; phase 4's machines add theirs here. */
const MACHINE_MESHES: Record<string, (width: number, depth: number) => MachineMesh> = { sawmill };

function footprint(machine: MachineContent | undefined): { width: number; depth: number } {
  const r = machine?.radius ?? 1;
  return { width: r * BUILDINGS.footprint.width, depth: r * BUILDINGS.footprint.depth };
}

/** Angle that turns a +z-facing building toward a point. */
const facing = (from: Vec2, to: Vec2): number => Math.atan2(to.x - from.x, to.z - from.z);

export class BuildingsView {
  private readonly views: BuildingView[] = [];
  private readonly pileItems: ItemInstances;
  private readonly dummy = new Object3D();

  constructor(
    scene: Scene,
    private readonly content: Content,
    state: SimState,
    models: Models,
  ) {
    const r = content.interaction.padRadius;
    const padGeo = new RingGeometry(r * 0.78, r, 32);
    const iconGeo = new PlaneGeometry(PILE.iconSize, PILE.iconSize);
    buildingPlots(content).forEach((plot, i) => {
      const machine = content.machines[plot.machine];
      const { site } = plot;
      const front = { x: (site.inputPad.x + site.outputPad.x) / 2, z: (site.inputPad.z + site.outputPad.z) / 2 };
      const size = footprint(machine);
      const build = MACHINE_MESHES[plot.machine] ?? sawmill;
      const { root, blade, materials } = build(size.width, size.depth);
      root.position.set(site.x, 0, site.z);
      root.rotation.y = facing(site, front);
      scene.add(root);

      const ghost = new Mesh(
        new PlaneGeometry(size.width, size.depth),
        new MeshBasicMaterial({ color: COLORS.plotDash, transparent: true, opacity: BUILDINGS.ghostOpacity }),
      );
      ghost.rotation.set(-Math.PI / 2, 0, root.rotation.y);
      ghost.position.set(site.x, 0.012, site.z);
      scene.add(ghost);

      const pads: BuildingView['pads'] = [];
      const items = machine ? [machine.input, machine.output] : [];
      [site.inputPad, site.outputPad].forEach((at, k) => {
        const material = new MeshLambertMaterial({ color: COLORS.pad });
        const ring = new Mesh(padGeo, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(at.x, 0.01, at.z);
        ring.receiveShadow = true;
        // Which item the pad takes or gives, drawn in its centre.
        const icon = new Mesh(iconGeo, new MeshLambertMaterial({ color: ITEM_COLORS[items[k] ?? ''] ?? COLORS.unknownItem }));
        icon.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
        icon.position.set(at.x, 0.012, at.z);
        scene.add(ring, icon);
        pads.push({ x: at.x, z: at.z, material, ring, icon });
      });

      const built = state.buildings[i]?.built ?? false;
      const view: BuildingView = {
        plot,
        root,
        blade,
        ghost,
        materials,
        pads,
        built,
        incoming: { input: 0, output: 0 },
        sinceBuilt: Infinity,
        opacity: 1,
      };
      this.views.push(view);
      this.applyBuilt(view);
    });

    const maxItems = Math.max(1, Object.values(content.machines).reduce((n, m) => n + m.pileCapacity * 2, 0) * this.views.length);
    this.pileItems = new ItemInstances(scene, models.log, maxItems);
  }

  private applyBuilt(v: BuildingView): void {
    v.root.visible = v.built;
    v.ghost.visible = !v.built;
    for (const p of v.pads) {
      p.ring.visible = v.built;
      p.icon.visible = v.built;
    }
  }

  /** yawRad is the camera's yaw, for working out what stands between it and the farmer. */
  update(s: SimState, playerX: number, playerZ: number, yawRad: number, dt: number): void {
    const r = this.content.interaction.padRadius;
    // Screen axes on the ground: right, and down (toward the camera).
    const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };
    const down = { x: Math.sin(yawRad), z: Math.cos(yawRad) };
    this.pileItems.begin();

    this.views.forEach((v, i) => {
      const b = s.buildings[i];
      const machine = this.content.machines[v.plot.machine];
      if (!b || !machine) return;
      if (b.built !== v.built) {
        v.built = b.built;
        v.sinceBuilt = 0;
        this.applyBuilt(v);
      }
      // Pop in with a small overshoot.
      if (v.sinceBuilt < BUILDINGS.popSeconds) {
        v.sinceBuilt += dt;
        const t = Math.min(1, v.sinceBuilt / BUILDINGS.popSeconds);
        const back = BUILDINGS.popOvershoot;
        const k = 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2;
        v.root.scale.setScalar(Math.max(0.01, k));
      }
      if (!b.built) return;

      const running = b.input > 0 && b.output < machine.pileCapacity;
      if (running) v.blade.rotation.y += dt * (BUILDINGS.bladeTurnsPerCycle * Math.PI * 2) / cycleSeconds(this.content, machine, b.speedLevel);

      for (const p of v.pads) {
        const on = Math.hypot(playerX - p.x, playerZ - p.z) <= r;
        p.material.color.setHex(on ? COLORS.padActive : COLORS.pad);
      }

      // Fade when the building stands between the camera and the farmer.
      const du = (v.plot.site.x - playerX) * right.x + (v.plot.site.z - playerZ) * right.z;
      const dv = (v.plot.site.x - playerX) * down.x + (v.plot.site.z - playerZ) * down.z;
      const covers = Math.abs(du) < machine.radius + BUILDINGS.fadeMargin && dv > -machine.radius && dv < machine.radius + BUILDINGS.fadeReach;
      const target = covers ? this.content.camera.buildingFadeOpacity : 1;
      v.opacity += (target - v.opacity) * Math.min(1, dt * BUILDINGS.fadeSpeed);
      for (const m of v.materials) m.opacity = v.opacity;

      this.writePile(v.plot.site.inputPile, machine.input, b.input - v.incoming.input, v.root.rotation.y);
      this.writePile(v.plot.site.outputPile, machine.output, b.output - v.incoming.output, v.root.rotation.y);
    });
    this.pileItems.end();
  }

  /** Where item k of a pile sits, and its yaw: PILE.perLayer side by side, each layer crossing the one below. */
  private pileSlot(at: Vec2, k: number, angle: number, out: Vector3): number {
    const layer = Math.floor(k / PILE.perLayer);
    const cross = layer % 2 === 1;
    const offset = ((k % PILE.perLayer) - (PILE.perLayer - 1) / 2) * PILE.depth * 1.1;
    // Items run along local x, side by side along z; crossed layers turn a quarter.
    const lx = cross ? offset : 0;
    const lz = cross ? 0 : offset;
    out.set(at.x + lx * Math.cos(angle) + lz * Math.sin(angle), PILE.height * (layer + 0.5), at.z - lx * Math.sin(angle) + lz * Math.cos(angle));
    return angle + (cross ? Math.PI / 2 : 0);
  }

  /** Slot k of a building's input or output pile in world space; returns the item's yaw there. */
  pileSlotWorld(building: number, which: 'input' | 'output', k: number, out: Vector3): number {
    const v = this.views[building];
    if (!v) return 0;
    return this.pileSlot(which === 'input' ? v.plot.site.inputPile : v.plot.site.outputPile, k, v.root.rotation.y, out);
  }

  /** Counts an item flying into a pile; returns the call that lands it. */
  expect(building: number, which: 'input' | 'output'): () => void {
    const v = this.views[building];
    if (!v) return () => {};
    v.incoming[which] += 1;
    return () => {
      v.incoming[which] = Math.max(0, v.incoming[which] - 1);
    };
  }

  private writePile(at: Vec2, item: string, count: number, angle: number): void {
    for (let k = 0; k < count; k++) {
      const yaw = this.pileSlot(at, k, angle, this.dummy.position);
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(PILE.length, PILE.height, PILE.depth);
      this.dummy.updateMatrix();
      if (!this.pileItems.add(item, this.dummy.matrix)) return;
    }
  }
}
