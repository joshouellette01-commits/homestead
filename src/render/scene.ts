import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Content } from '../content';
import { buildingPlots, playerStats } from '../sim/plots';
import type { SimState } from '../sim/state';
import type { SimEvent } from '../sim/tick';
import { BuildingsView } from './buildings';
import { IsoCamera } from './camera';
import { COLORS, LIGHTING, RENDER } from './config';
import { FarmerView } from './farmer';
import { FlightsView } from './flights';
import type { Models } from './models';
import { PlotsView } from './plots';
import { PropsView } from './props';
import { TreesView } from './trees';

/** Player position at the previous and current sim step, for interpolation. */
export interface PlayerFrame {
  prevX: number;
  prevZ: number;
  alpha: number;
}

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly iso: IsoCamera;
  readonly farmer: FarmerView;
  private readonly sun: DirectionalLight;
  private readonly trees: TreesView;
  private readonly props: PropsView;
  private readonly plots: PlotsView;
  private readonly buildings: BuildingsView;
  private readonly flights: FlightsView;
  /** Pad id to the building it belongs to and which of its pads it is. */
  private readonly buildingPads = new Map<string, { building: number; kind: 'input' | 'output' | 'build' }>();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private shadows = true;
  /** Set when shadows were switched by hand, so the startup probe leaves them alone. */
  shadowsOverridden = false;

  constructor(container: HTMLElement, private readonly content: Content, state: SimState, models: Models) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(COLORS.sky);
    this.iso = new IsoCamera(content.camera);

    // One hemisphere plus one directional light, per DESIGN.md's performance rules.
    this.scene.add(new HemisphereLight(COLORS.sky, COLORS.hemiGround, LIGHTING.hemiIntensity));
    this.sun = new DirectionalLight(COLORS.sun, LIGHTING.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -RENDER.shadowExtent;
    cam.right = cam.top = RENDER.shadowExtent;
    cam.near = 1;
    cam.far = RENDER.shadowFar;
    this.scene.add(this.sun, this.sun.target);

    const ground = new Mesh(
      new PlaneGeometry(content.world.width, content.world.depth),
      new MeshLambertMaterial({ color: COLORS.snow }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.trees = new TreesView(this.scene, state.nodes, content, models);
    this.props = new PropsView(this.scene, content);
    this.buildings = new BuildingsView(this.scene, content, state, models);
    // Plot prices float over the world, under the HUD.
    const labels = document.createElement('div');
    labels.className = 'world-labels';
    container.appendChild(labels);
    this.plots = new PlotsView(this.scene, labels, content);
    this.farmer = new FarmerView(this.scene, content, models);
    this.flights = new FlightsView(this.scene, models.log, content);
    buildingPlots(content).forEach((plot, building) => {
      this.buildingPads.set(plot.id, { building, kind: 'build' });
      this.buildingPads.set(`${plot.id}-input`, { building, kind: 'input' });
      this.buildingPads.set(`${plot.id}-output`, { building, kind: 'output' });
    });

    this.iso.snapTo(state.player.x, state.player.z);
  }

  get shadowsEnabled(): boolean {
    return this.shadows;
  }

  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // Materials compile with or without shadow code; force a recompile.
    this.scene.traverse((o) => {
      if (o instanceof Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.iso.resize(width, height);
  }

  handleEvents(events: readonly SimEvent[], state: SimState): void {
    const stackLen = state.player.stack.length;
    let leaving = 0;
    for (const e of events) {
      if (e.type === 'harvest') this.trees.hit(e.node);
      if (e.type === 'sell' || e.type === 'deliver') {
        // The item left the top of the stack: fly it from where it sat.
        this.farmer.stackSlotWorld(stackLen - this.farmer.incoming + leaving, this.from);
        leaving++;
        const yaw = this.farmer.yaw;
        if (e.type === 'sell') {
          const top = this.props.tableTops.get(e.pad);
          if (top) this.flights.launch(e.item, this.from, this.to.set(top.x, top.y, top.z), yaw, yaw + Math.PI / 2);
          continue;
        }
        const pad = this.buildingPads.get(e.pad);
        const b = pad && state.buildings[pad.building];
        if (!pad || !b) continue;
        if (pad.kind === 'input') {
          const pileYaw = this.buildings.pileSlotWorld(pad.building, 'input', b.input - 1, this.to);
          this.flights.launch(e.item, this.from, this.to, yaw, pileYaw, this.buildings.expect(pad.building, 'input'));
        } else {
          // Materials go into the plot: fly to the middle of its footprint.
          const site = buildingPlots(this.content)[pad.building]?.site;
          if (site) this.flights.launch(e.item, this.from, this.to.set(site.x, 0.3, site.z), yaw, yaw);
        }
      }
      if (e.type === 'collect') {
        const pad = this.buildingPads.get(e.pad);
        const b = pad && state.buildings[pad.building];
        if (!pad || !b) continue;
        const pileYaw = this.buildings.pileSlotWorld(pad.building, 'output', b.output, this.from);
        // Lands on the slot above everything already shown or flying in.
        this.farmer.stackSlotWorld(stackLen - 1, this.to);
        this.farmer.incoming += 1;
        this.flights.launch(e.item, this.from, this.to, pileYaw, this.farmer.yaw, () => {
          this.farmer.incoming = Math.max(0, this.farmer.incoming - 1);
        });
      }
    }
  }

  update(state: SimState, frame: PlayerFrame, dt: number): void {
    const p = state.player;
    const x = frame.prevX + (p.x - frame.prevX) * frame.alpha;
    const z = frame.prevZ + (p.z - frame.prevZ) * frame.alpha;

    // While harvesting, face the node being worked.
    const node = p.harvesting >= 0 ? state.nodes[p.harvesting] : undefined;
    const moving = p.vx !== 0 || p.vz !== 0;
    const stats = playerStats(state, this.content);
    const facing = node && !moving ? Math.atan2(node.x - x, node.z - z) : p.facing;
    this.farmer.update(
      {
        x,
        z,
        vx: p.vx,
        vz: p.vz,
        facing,
        swing: node ? p.swingTimer / stats.swingSeconds : null,
        stack: p.stack,
        capacity: stats.capacity,
      },
      dt,
    );
    this.trees.update(state.nodes, dt);
    this.props.update(p.x, p.z, !moving);
    this.buildings.update(state, x, z, this.iso.yawRad, dt);
    this.flights.update(dt);

    this.iso.follow(x, z, dt);
    const t = this.iso.target;
    this.sun.position.set(t.x + LIGHTING.sunOffset[0], LIGHTING.sunOffset[1], t.z + LIGHTING.sunOffset[2]);
    this.sun.target.position.copy(t);
  }

  render(state: SimState): void {
    this.renderer.render(this.scene, this.iso.camera);
    // After the render, so labels use this frame's camera.
    this.plots.update(state, this.iso.camera);
  }
}
