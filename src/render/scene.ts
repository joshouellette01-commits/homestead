import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Content } from '../content';
import type { SimState } from '../sim/state';
import type { SimEvent } from '../sim/tick';
import { IsoCamera } from './camera';
import { COLORS, LIGHTING, RENDER } from './config';
import { FarmerView } from './farmer';
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
  private shadows = true;

  constructor(container: HTMLElement, private readonly content: Content, state: SimState) {
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

    this.trees = new TreesView(this.scene, state.nodes, content);
    this.props = new PropsView(this.scene, content);
    this.farmer = new FarmerView(this.scene, content);

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

  handleEvents(events: readonly SimEvent[]): void {
    for (const e of events) if (e.type === 'harvest') this.trees.hit(e.node);
  }

  update(state: SimState, frame: PlayerFrame, dt: number): void {
    const p = state.player;
    const x = frame.prevX + (p.x - frame.prevX) * frame.alpha;
    const z = frame.prevZ + (p.z - frame.prevZ) * frame.alpha;

    // While harvesting, face the node being worked.
    const node = p.harvesting >= 0 ? state.nodes[p.harvesting] : undefined;
    const moving = p.vx !== 0 || p.vz !== 0;
    const facing = node && !moving ? Math.atan2(node.x - x, node.z - z) : p.facing;
    this.farmer.update(
      {
        x,
        z,
        vx: p.vx,
        vz: p.vz,
        facing,
        swing: node ? p.swingTimer / this.content.player.swingSeconds : null,
        stack: p.stack,
      },
      dt,
    );
    this.trees.update(state.nodes, dt);
    this.props.update(x, z);

    this.iso.follow(x, z, dt);
    const t = this.iso.target;
    this.sun.position.set(t.x + LIGHTING.sunOffset[0], LIGHTING.sunOffset[1], t.z + LIGHTING.sunOffset[2]);
    this.sun.target.position.copy(t);
  }

  render(): void {
    this.renderer.render(this.scene, this.iso.camera);
  }
}
