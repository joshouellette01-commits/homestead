// All trees drawn as three instanced meshes (trunk, foliage, snow cap).
import {
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Content } from '../content';
import type { NodeState } from '../sim/state';
import { COLORS } from './config';

const TRUNK_HEIGHT = 0.9;
const STUMP_HEIGHT = 0.25;
const SHAKE_SECONDS = 0.25;
const SHAKE_ANGLE = 0.12;

export class TreesView {
  private readonly trunk: InstancedMesh;
  private readonly foliage: InstancedMesh;
  private readonly snow: InstancedMesh;
  private readonly indices: number[] = [];
  private readonly shake: number[] = [];
  private readonly dummy = new Object3D();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(scene: Scene, nodes: readonly NodeState[], private readonly content: Content) {
    nodes.forEach((n, i) => {
      if (n.type === 'tree') this.indices.push(i);
    });
    const count = Math.max(1, this.indices.length);

    const trunkGeo = new CylinderGeometry(0.14, 0.2, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const lower = new ConeGeometry(0.85, 1.3, 7);
    lower.translate(0, 0.65, 0);
    const upper = new ConeGeometry(0.6, 1.0, 7);
    upper.translate(0, 1.35, 0);
    const foliageGeo = mergeGeometries([lower, upper]);
    const snowGeo = new ConeGeometry(0.32, 0.45, 7);
    snowGeo.translate(0, 1.66, 0);

    this.trunk = new InstancedMesh(trunkGeo, new MeshLambertMaterial({ color: COLORS.trunk }), count);
    this.foliage = new InstancedMesh(foliageGeo, new MeshLambertMaterial({ color: COLORS.pine }), count);
    this.snow = new InstancedMesh(snowGeo, new MeshLambertMaterial({ color: COLORS.pineSnow }), count);
    for (const m of [this.trunk, this.foliage, this.snow]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
    this.shake = this.indices.map(() => 0);
  }

  hit(nodeIndex: number): void {
    const slot = this.indices.indexOf(nodeIndex);
    if (slot >= 0) this.shake[slot] = SHAKE_SECONDS;
  }

  update(nodes: readonly NodeState[], dt: number): void {
    this.indices.forEach((nodeIndex, slot) => {
      const n = nodes[nodeIndex];
      const type = n && this.content.nodeTypes[n.type];
      if (!n || !type) return;
      const shake = Math.max(0, (this.shake[slot] ?? 0) - dt);
      this.shake[slot] = shake;
      const tilt = Math.sin(shake * 60) * SHAKE_ANGLE * (shake / SHAKE_SECONDS);

      const d = this.dummy;
      d.position.set(n.x, 0, n.z);
      d.rotation.set(tilt, 0, tilt * 0.6);

      if (n.remaining > 0) {
        d.scale.set(1, TRUNK_HEIGHT, 1);
        d.updateMatrix();
        this.trunk.setMatrixAt(slot, d.matrix);
        d.position.y = TRUNK_HEIGHT * 0.55;
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.foliage.setMatrixAt(slot, d.matrix);
        this.snow.setMatrixAt(slot, d.matrix);
      } else {
        // Depleted: a stump with a sapling growing back over regrowSeconds.
        d.scale.set(1, STUMP_HEIGHT, 1);
        d.updateMatrix();
        this.trunk.setMatrixAt(slot, d.matrix);
        const grown = 1 - n.regrowLeft / type.regrowSeconds;
        const s = 0.15 + 0.45 * Math.max(0, grown);
        d.position.y = STUMP_HEIGHT;
        d.scale.set(s, s, s);
        d.updateMatrix();
        this.foliage.setMatrixAt(slot, d.matrix);
        this.snow.setMatrixAt(slot, this.hidden);
      }
    });
    this.trunk.instanceMatrix.needsUpdate = true;
    this.foliage.instanceMatrix.needsUpdate = true;
    this.snow.instanceMatrix.needsUpdate = true;
  }
}
