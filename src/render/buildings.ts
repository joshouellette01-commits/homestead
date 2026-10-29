// Machines: the building itself (from primitives, per DESIGN.md), a faint
// footprint before it is built, its input and output pads, and the piles
// beside them. Buildings between the camera and the farmer fade.
import {
  BoxGeometry,
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
import { buildingPlots, cycleSeconds, inputSource, machineInputs } from '../sim/plots';
import type { SimState } from '../sim/state';
import { BUILDINGS, COLORS, ITEM_COLORS, PILE } from './config';
import { ItemInstances } from './items';
import { MACHINE_MESHES, fallbackMesh, type MachineMesh } from './machines';
import type { Models } from './models';

interface BuildingView {
  plot: BuildingPlotContent;
  root: Group;
  /** Spins while the machine is running, if anything does. */
  spinner: MachineMesh['spinner'];
  ghost: Mesh;
  /** Extra pieces that appear with the building, like a trough. */
  troughs: Mesh[];
  materials: MeshLambertMaterial[];
  pads: Array<{ x: number; z: number; material: MeshLambertMaterial; ring: Mesh; icon: Mesh }>;
  built: boolean;
  /** Items still flying into each pile; hidden until they land. */
  incoming: { inputs: Record<string, number>; output: number };
  /** Seconds since it was built, for the pop-in; Infinity once settled. */
  sinceBuilt: number;
  opacity: number;
}

/** One of a building's piles: an input pile by item, or its output pile. */
export type PileRef = 'output' | { input: string };

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
      // Faces the middle of its own pads, where the player works it.
      const ownPads = [...Object.values(site.inputs).flatMap((w) => ('pad' in w ? [w.pad] : [])), site.outputPad];
      const front = {
        x: ownPads.reduce((sum, p) => sum + p.x, 0) / ownPads.length,
        z: ownPads.reduce((sum, p) => sum + p.z, 0) / ownPads.length,
      };
      const size = footprint(machine);
      const build = MACHINE_MESHES[plot.machine] ?? fallbackMesh;
      const { root, spinner, materials } = build(size.width, size.depth);
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

      // Animals eat from a trough: a low wooden box under the feed pile.
      const troughs: Mesh[] = [];
      if (machine?.kind === 'animals') {
        const where = site.inputs[machine.feed];
        if (where && 'pile' in where) {
          const trough = new Mesh(new BoxGeometry(PILE.length * 1.3, BUILDINGS.troughHeight, PILE.depth * 4.2), new MeshLambertMaterial({ color: COLORS.sawmillBase, transparent: true }));
          trough.position.set(where.pile.x, BUILDINGS.troughHeight / 2, where.pile.z);
          trough.rotation.y = root.rotation.y;
          trough.castShadow = true;
          trough.receiveShadow = true;
          root.parent?.add(trough);
          troughs.push(trough);
        }
      }

      const pads: BuildingView['pads'] = [];
      const padItems: Array<{ at: Vec2; item: string }> = Object.entries(site.inputs).flatMap(([item, w]) =>
        'pad' in w ? [{ at: w.pad, item }] : [],
      );
      if (machine) padItems.push({ at: site.outputPad, item: machine.output });
      padItems.forEach(({ at, item }) => {
        const material = new MeshLambertMaterial({ color: COLORS.pad });
        const ring = new Mesh(padGeo, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(at.x, 0.01, at.z);
        ring.receiveShadow = true;
        // Which item the pad takes or gives, drawn in its centre.
        const icon = new Mesh(iconGeo, new MeshLambertMaterial({ color: ITEM_COLORS[item] ?? COLORS.unknownItem }));
        icon.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
        icon.position.set(at.x, 0.012, at.z);
        scene.add(ring, icon);
        pads.push({ x: at.x, z: at.z, material, ring, icon });
      });

      const built = state.buildings[i]?.built ?? false;
      const view: BuildingView = {
        plot,
        root,
        spinner,
        ghost,
        troughs,
        materials,
        pads,
        built,
        incoming: { inputs: {}, output: 0 },
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
    for (const t of v.troughs) t.visible = v.built;
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

      const running = b.output < machine.pileCapacity && machineInputs(machine).every((item) => (inputSource(s, this.content, i, item)?.count ?? 0) > 0);
      if (running && v.spinner) v.spinner.rotation.y += dt * (BUILDINGS.bladeTurnsPerCycle * Math.PI * 2) / cycleSeconds(this.content, machine, b.level);

      for (const p of v.pads) {
        const on = Math.hypot(playerX - p.x, playerZ - p.z) <= r;
        p.material.color.setHex(on ? COLORS.padActive : COLORS.pad);
      }

      // Fade when the building stands between the camera and the farmer.
      const du = (v.plot.site.x - playerX) * right.x + (v.plot.site.z - playerZ) * right.z;
      const dv = (v.plot.site.x - playerX) * down.x + (v.plot.site.z - playerZ) * down.z;
      // dv > 0: the building is nearer the camera than the farmer.
      const covers = Math.abs(du) < machine.radius + BUILDINGS.fadeMargin && dv > 0 && dv < machine.radius + BUILDINGS.fadeReach;
      const target = covers ? this.content.camera.buildingFadeOpacity : 1;
      v.opacity += (target - v.opacity) * Math.min(1, dt * BUILDINGS.fadeSpeed);
      for (const m of v.materials) m.opacity = v.opacity;

      for (const [item, where] of Object.entries(v.plot.site.inputs)) {
        if ('pile' in where) this.writePile(where.pile, item, (b.inputs[item] ?? 0) - (v.incoming.inputs[item] ?? 0), v.root.rotation.y);
      }
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

  private pileAt(v: BuildingView, which: PileRef): Vec2 {
    if (which === 'output') return v.plot.site.outputPile;
    const where = v.plot.site.inputs[which.input];
    return where && 'pile' in where ? where.pile : v.plot.site;
  }

  /** Slot k of one of a building's piles in world space; returns the item's yaw there. */
  pileSlotWorld(building: number, which: PileRef, k: number, out: Vector3): number {
    const v = this.views[building];
    if (!v) return 0;
    return this.pileSlot(this.pileAt(v, which), k, v.root.rotation.y, out);
  }

  /** Which way a building faces. */
  yawOf(building: number): number {
    return this.views[building]?.root.rotation.y ?? 0;
  }

  /** Counts an item flying into a pile; returns the call that lands it. */
  expect(building: number, which: PileRef): () => void {
    const v = this.views[building];
    if (!v) return () => {};
    const { incoming } = v;
    if (which === 'output') {
      incoming.output += 1;
      return () => void (incoming.output = Math.max(0, incoming.output - 1));
    }
    const item = which.input;
    incoming.inputs[item] = (incoming.inputs[item] ?? 0) + 1;
    return () => void (incoming.inputs[item] = Math.max(0, (incoming.inputs[item] ?? 0) - 1));
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
