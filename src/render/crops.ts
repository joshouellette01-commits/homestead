// Crop nodes (wheat) as instanced meshes: a dirt mound under every plant, the
// ripe crop while it can be harvested, and a sprout growing back after.
import { InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, type Scene } from 'three';
import type { Content } from '../content';
import type { NodeState } from '../sim/state';
import { COLORS, CROPS, CROP_COLORS, MODEL_COLORS } from './config';
import type { Model, Models } from './models';

function instanced(scene: Scene, model: Model, count: number, colors: Record<string, number>): InstancedMesh[] {
  return model.parts.map((p) => {
    const color = colors[p.material] ?? MODEL_COLORS[p.material] ?? COLORS.unknownItem;
    const m = new InstancedMesh(p.geometry, new MeshLambertMaterial({ color }), count);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  });
}

export class CropsView {
  private readonly ripe: InstancedMesh[];
  private readonly sprout: InstancedMesh[];
  private readonly dirt: InstancedMesh[];
  private readonly indices: number[] = [];
  private readonly shake: number[] = [];
  private readonly dummy = new Object3D();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(scene: Scene, nodes: readonly NodeState[], private readonly content: Content, models: Models) {
    nodes.forEach((n, i) => {
      if (content.nodeTypes[n.type]?.solid === false) this.indices.push(i);
    });
    const count = Math.max(1, this.indices.length);
    this.ripe = instanced(scene, models.wheat, count, CROP_COLORS);
    this.sprout = instanced(scene, models.sprout, count, CROP_COLORS);
    this.dirt = instanced(scene, models.dirt, count, {});
    this.shake = this.indices.map(() => 0);

    // Mounds never move: place them once.
    const d = this.dummy;
    this.indices.forEach((nodeIndex, slot) => {
      const n = nodes[nodeIndex];
      if (!n) return;
      d.position.set(n.x, 0, n.z);
      d.rotation.set(0, (slot * 1.3) % (Math.PI * 2), 0);
      d.scale.setScalar(CROPS.dirtScale);
      d.updateMatrix();
      for (const m of this.dirt) m.setMatrixAt(slot, d.matrix);
    });
    for (const m of this.dirt) m.instanceMatrix.needsUpdate = true;
  }

  hit(nodeIndex: number): void {
    const slot = this.indices.indexOf(nodeIndex);
    if (slot >= 0) this.shake[slot] = this.content.feel.treeShakeSeconds;
  }

  update(nodes: readonly NodeState[], dt: number): void {
    const d = this.dummy;
    this.indices.forEach((nodeIndex, slot) => {
      const n = nodes[nodeIndex];
      const type = n && this.content.nodeTypes[n.type];
      if (!n || !type) return;
      const shake = Math.max(0, (this.shake[slot] ?? 0) - dt);
      this.shake[slot] = shake;
      const { treeShakeSeconds, cropShakeAngle } = this.content.feel;
      const tilt = Math.sin(shake * 60) * cropShakeAngle * (shake / treeShakeSeconds);
      d.position.set(n.x, CROPS.lift, n.z);
      d.rotation.set(tilt, (slot * 1.3) % (Math.PI * 2), tilt * 0.6);
      if (n.remaining > 0) {
        d.scale.setScalar(CROPS.scale);
        d.updateMatrix();
        for (const m of this.ripe) m.setMatrixAt(slot, d.matrix);
        for (const m of this.sprout) m.setMatrixAt(slot, this.hidden);
      } else {
        // Harvested: a sprout that grows back over regrowSeconds.
        const grown = Math.max(0, 1 - n.regrowLeft / type.regrowSeconds);
        d.scale.setScalar(CROPS.scale * (CROPS.sproutMin + (1 - CROPS.sproutMin) * grown));
        d.updateMatrix();
        for (const m of this.sprout) m.setMatrixAt(slot, d.matrix);
        for (const m of this.ripe) m.setMatrixAt(slot, this.hidden);
      }
    });
    for (const m of [...this.ripe, ...this.sprout]) {
      m.instanceMatrix.needsUpdate = true;
      // Bounds follow the hidden/shown swaps, or three.js culls by stale ones.
      m.boundingSphere = null;
    }
  }
}
