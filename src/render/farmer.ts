// Placeholder farmer built from primitives, with a swing animation and the
// carried stack on its back. The glTF farmer replaces the body in phase 3.
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Content } from '../content';
import { COLORS, FARMER, ITEM_COLORS, STACK_ITEM } from './config';

/** Upper bound on stack instances; the stack never renders more than this. */
const MAX_STACK = 100;

export interface FarmerPose {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Direction to face, radians. */
  facing: number;
  /** 0..1 progress through the current swing, or null when not harvesting. */
  swing: number | null;
  stack: readonly string[];
  /** Current carry capacity; the stack's sway is scaled to a full stack. */
  capacity: number;
}

export class FarmerView {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly arm = new Group();
  private readonly stackMesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly color = new Color();
  private heading = 0;
  private walkPhase = 0;
  // Stack sway spring: world-space displacement of the stack top, and its velocity.
  private readonly sway = { x: 0, z: 0, vx: 0, vz: 0 };
  private stackTop = 0;

  constructor(scene: Scene, private readonly content: Content) {
    const mat = (color: number): MeshLambertMaterial => new MeshLambertMaterial({ color });

    const legs = new Mesh(new CylinderGeometry(0.22, 0.24, 0.45, 8), mat(COLORS.farmerPants));
    legs.position.y = 0.22;
    const torso = new Mesh(new CapsuleGeometry(FARMER.bodyRadius, FARMER.bodyLength * 0.6, 4, 10), mat(COLORS.farmerShirt));
    torso.position.y = 0.75;
    const head = new Mesh(new SphereGeometry(FARMER.headRadius, 12, 10), mat(COLORS.farmerSkin));
    head.position.y = 1.3;
    const brim = new Mesh(new CylinderGeometry(0.34, 0.34, 0.04, 14), mat(COLORS.farmerHat));
    brim.position.y = 1.45;
    const crown = new Mesh(new ConeGeometry(0.2, 0.24, 12), mat(COLORS.farmerHat));
    crown.position.y = 1.58;
    this.body.add(legs, torso, head, brim, crown);

    // Arm holding an axe; pivots at the shoulder.
    const upper = new Mesh(new BoxGeometry(0.12, 0.5, 0.12), mat(COLORS.farmerShirt));
    upper.position.y = -0.22;
    const handle = new Mesh(new BoxGeometry(0.05, 0.05, 0.6), mat(COLORS.trunk));
    handle.position.set(0, -0.45, 0.28);
    const blade = new Mesh(new BoxGeometry(0.04, 0.2, 0.16), mat(COLORS.tool));
    blade.position.set(0, -0.4, 0.55);
    this.arm.add(upper, handle, blade);
    this.arm.position.set(0.36, 1.0, 0.05);
    this.body.add(this.arm);

    this.root.add(this.body);
    this.root.traverse((o) => {
      o.castShadow = true;
    });

    this.stackMesh = new InstancedMesh(
      new BoxGeometry(STACK_ITEM.length, 1, STACK_ITEM.depth),
      new MeshLambertMaterial(),
      MAX_STACK,
    );
    this.stackMesh.castShadow = true;
    this.stackMesh.count = 0;
    scene.add(this.root, this.stackMesh);
  }

  /** World position just above the top of the stack, for the full-stack icon. */
  stackTopWorld(out: Vector3): Vector3 {
    const back = -FARMER.stackBackOffset;
    return out.set(
      this.root.position.x + Math.sin(this.heading) * back + this.sway.x,
      this.stackTop + 0.35,
      this.root.position.z + Math.cos(this.heading) * back + this.sway.z,
    );
  }

  update(pose: FarmerPose, dt: number): void {
    this.root.position.set(pose.x, 0, pose.z);

    // Turn smoothly toward the desired heading along the shortest arc.
    let delta = pose.facing - this.heading;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const f = this.content.feel;
    this.heading += delta * Math.min(1, f.turnSpeed * dt);
    this.root.rotation.y = this.heading;

    const speed = Math.hypot(pose.vx, pose.vz);
    this.walkPhase += speed * dt * f.walkBobPerUnit;
    this.body.position.y = speed > 0 ? Math.abs(Math.sin(this.walkPhase)) * f.walkBobHeight : 0;

    // Placeholder swing until the glTF farmer's animation clips arrive:
    // wind up over the first 70% of the cycle, strike on the last 30%.
    if (pose.swing !== null) {
      const t = pose.swing;
      const angle = t < 0.7 ? -(t / 0.7) * 2.2 : -2.2 + ((t - 0.7) / 0.3) * 3.0;
      this.arm.rotation.x = angle;
      this.body.rotation.x = t < 0.7 ? -0.05 : 0.15;
    } else {
      this.arm.rotation.x = Math.sin(this.walkPhase) * 0.4 * Math.min(1, speed);
      this.body.rotation.x = 0;
    }

    this.updateSway(pose, dt);
    this.updateStack(pose.stack, pose.capacity);
  }

  private updateSway(pose: FarmerPose, dt: number): void {
    const f = this.content.feel;
    // Lean opposite to motion; the spring lags, overshoots and settles.
    const clamp = (v: number): number => Math.max(-f.stackSwayMax, Math.min(f.stackSwayMax, v));
    const tx = clamp(-pose.vx * f.stackSwayPerSpeed);
    const tz = clamp(-pose.vz * f.stackSwayPerSpeed);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const s = this.sway;
    for (let i = 0; i < steps; i++) {
      s.vx += (f.stackSwayStiffness * (tx - s.x) - f.stackSwayDamping * s.vx) * h;
      s.vz += (f.stackSwayStiffness * (tz - s.z) - f.stackSwayDamping * s.vz) * h;
      s.x = clamp(s.x + s.vx * h);
      s.z = clamp(s.z + s.vz * h);
    }
  }

  private updateStack(stack: readonly string[], capacity: number): void {
    const f = this.content.feel;
    const n = Math.min(stack.length, MAX_STACK);
    const back = -FARMER.stackBackOffset;
    const baseX = this.root.position.x + Math.sin(this.heading) * back;
    const baseZ = this.root.position.z + Math.cos(this.heading) * back;
    const baseY = FARMER.stackBaseHeight + this.body.position.y;
    const fullHeight = Math.max(1, capacity) * f.stackItemHeight;

    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      // Sway grows with the square of height, so the top moves most.
      const t = ((i + 0.5) * f.stackItemHeight) / fullHeight;
      const bend = t * t;
      d.position.set(baseX + this.sway.x * bend, baseY + (i + 0.5) * f.stackItemHeight, baseZ + this.sway.z * bend);
      d.rotation.set(0, this.heading, 0);
      d.scale.set(1, f.stackItemHeight * 0.92, 1);
      d.updateMatrix();
      this.stackMesh.setMatrixAt(i, d.matrix);
      this.stackMesh.setColorAt(i, this.color.setHex(ITEM_COLORS[stack[i] ?? ''] ?? COLORS.unknownItem));
    }
    if (this.stackMesh.instanceColor) this.stackMesh.instanceColor.needsUpdate = true;
    this.stackMesh.count = n;
    this.stackMesh.instanceMatrix.needsUpdate = true;
    this.stackTop = baseY + n * f.stackItemHeight;
  }
}
