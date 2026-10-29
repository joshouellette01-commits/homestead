import {
  BoxGeometry,
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
import { IsoCamera } from './camera';
import { COLORS, RENDER } from './config';

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly iso: IsoCamera;
  private readonly sun: DirectionalLight;

  constructor(container: HTMLElement, content: Content) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(COLORS.sky);
    this.iso = new IsoCamera(content.camera);

    // One hemisphere plus one directional light, per DESIGN.md's performance rules.
    this.scene.add(new HemisphereLight(COLORS.sky, COLORS.hemiGround, 1.6));
    this.sun = new DirectionalLight(COLORS.sun, 2.2);
    this.sun.position.set(-12, 30, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -RENDER.shadowExtent;
    cam.right = cam.top = RENDER.shadowExtent;
    cam.near = 1;
    cam.far = 80;
    this.scene.add(this.sun, this.sun.target);

    const ground = new Mesh(
      new PlaneGeometry(content.world.width, content.world.depth),
      new MeshLambertMaterial({ color: COLORS.snow }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Placeholder at the spawn point so the phone build shows framing,
    // lighting and shadows. Replaced by the farmer in phase 2.
    const marker = new Mesh(new BoxGeometry(0.8, 1.6, 0.8), new MeshLambertMaterial({ color: COLORS.marker }));
    marker.position.set(content.player.spawn.x, 0.8, content.player.spawn.z);
    marker.castShadow = true;
    this.scene.add(marker);

    this.iso.lookAt(content.player.spawn.x, content.player.spawn.z);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.iso.resize(width, height);
  }

  render(): void {
    this.renderer.render(this.scene, this.iso.camera);
  }
}
