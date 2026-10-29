import { OrthographicCamera, Vector3 } from 'three';
import type { CameraContent } from '../content';
import { RENDER } from './config';

const DEG = Math.PI / 180;

/** Fixed isometric camera: orthographic, no rotate, no zoom. */
export class IsoCamera {
  readonly camera = new OrthographicCamera();
  private readonly offset: Vector3;
  private readonly target = new Vector3();

  constructor(private readonly cfg: CameraContent) {
    const pitch = cfg.pitchDeg * DEG;
    const yaw = cfg.yawDeg * DEG;
    this.offset = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(RENDER.cameraDistance);
    this.camera.near = 1;
    this.camera.far = RENDER.cameraDistance * 2;
    this.place();
  }

  /** viewSize world units span the shorter side of the screen. */
  resize(width: number, height: number): void {
    const aspect = width / height;
    const halfShort = this.cfg.viewSize / 2;
    const halfW = aspect < 1 ? halfShort : halfShort * aspect;
    const halfH = aspect < 1 ? halfShort / aspect : halfShort;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to a point; following with lerp arrives in phase 2. */
  lookAt(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.place();
  }

  private place(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }
}
