import { OrthographicCamera, Vector3 } from 'three';
import type { CameraContent } from '../content';
import { RENDER } from './config';

const DEG = Math.PI / 180;

/** Fixed isometric camera: orthographic, no rotate, no zoom; follows a target. */
export class IsoCamera {
  readonly camera = new OrthographicCamera();
  readonly target = new Vector3();
  private readonly offset = new Vector3();
  private width = 1;
  private height = 1;

  constructor(private readonly cfg: CameraContent) {
    this.camera.near = 1;
    this.camera.far = RENDER.cameraDistance * 2;
  }

  get yawRad(): number {
    return this.cfg.yawDeg * DEG;
  }

  /** viewSize world units span the shorter side of the screen. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applyProjection();
  }

  /** Jump straight to a point. */
  snapTo(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.place();
  }

  /** Ease toward a point with a followLerpSeconds time constant. */
  follow(x: number, z: number, dt: number): void {
    const tau = this.cfg.followLerpSeconds;
    const t = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    this.target.x += (x - this.target.x) * t;
    this.target.z += (z - this.target.z) * t;
    this.place();
  }

  private applyProjection(): void {
    const aspect = this.width / this.height;
    const halfShort = this.cfg.viewSize / 2;
    const halfW = aspect < 1 ? halfShort : halfShort * aspect;
    const halfH = aspect < 1 ? halfShort / aspect : halfShort;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    // Re-read the angles each time so ?debug tuning applies live.
    const pitch = this.cfg.pitchDeg * DEG;
    const yaw = this.yawRad;
    this.offset
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(RENDER.cameraDistance);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  /** Call after viewSize changes. */
  refresh(): void {
    this.applyProjection();
    this.place();
  }
}
