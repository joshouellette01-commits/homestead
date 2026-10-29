// All trees as instanced meshes: the Kenney pine (one mesh per material), our
// snow cap on top, and the Kenney stump with a sapling while a tree regrows.
import {
  ConeGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  type Scene,
} from 'three';
import type { Content } from '../content';
import type { NodeState } from '../sim/state';
import { COLORS, MODEL_COLORS, TREES } from './config';
import type { Model, Models } from './models';

function instanced(scene: Scene, model: Model, count: number): InstancedMesh[] {
  return model.parts.map((p) => {
    const m = new InstancedMesh(p.geometry, new MeshLambertMaterial({ color: MODEL_COLORS[p.material] ?? COLORS.unknownItem }), count);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  });
}

export class TreesView {
  private readonly pine: InstancedMesh[];
  private readonly stump: InstancedMesh[];
  private readonly snow: InstancedMesh;
  private readonly pineHeight: number;
  private readonly indices: number[] = [];
  private readonly shake: number[] = [];
  private readonly dummy = new Object3D();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(scene: Scene, nodes: readonly NodeState[], private readonly content: Content, models: Models) {
    nodes.forEach((n, i) => {
      if (n.type === 'tree') this.indices.push(i);
    });
    const count = Math.max(1, this.indices.length);

    this.pine = instanced(scene, models.pine, count);
    this.stump = instanced(scene, models.stump, count);
    this.pineHeight = models.pine.size.y;
    // A snow cap on the very top, sized for the unscaled model.
    const snowGeo = new ConeGeometry(TREES.snowCapRadius / TREES.scale, TREES.snowCapHeight / TREES.scale, 7);
    snowGeo.translate(0, this.pineHeight - TREES.snowCapHeight / TREES.scale / 2 + 0.01, 0);
    this.snow = new InstancedMesh(snowGeo, new MeshLambertMaterial({ color: COLORS.pineSnow }), count);
    this.snow.castShadow = true;
    scene.add(this.snow);
    this.shake = this.indices.map(() => 0);
  }

  hit(nodeIndex: number): void {
    const slot = this.indices.indexOf(nodeIndex);
    if (slot >= 0) this.shake[slot] = this.content.feel.treeShakeSeconds;
  }

  private set(meshes: InstancedMesh[], slot: number, matrix: Matrix4): void {
    for (const m of meshes) m.setMatrixAt(slot, matrix);
  }

  update(nodes: readonly NodeState[], dt: number): void {
    this.indices.forEach((nodeIndex, slot) => {
      const n = nodes[nodeIndex];
      const type = n && this.content.nodeTypes[n.type];
      if (!n || !type) return;
      const shake = Math.max(0, (this.shake[slot] ?? 0) - dt);
      this.shake[slot] = shake;
      const { treeShakeSeconds, treeShakeAngle } = this.content.feel;
      const tilt = Math.sin(shake * 60) * treeShakeAngle * (shake / treeShakeSeconds);

      const d = this.dummy;
      d.position.set(n.x, 0, n.z);
      d.rotation.set(tilt, 0, tilt * 0.6);

      if (n.remaining > 0) {
        d.scale.setScalar(TREES.scale);
        d.updateMatrix();
        this.set(this.pine, slot, d.matrix);
        this.snow.setMatrixAt(slot, d.matrix);
        this.set(this.stump, slot, this.hidden);
      } else {
        // Depleted: just the stump at first; then the tree grows back up from
        // that spot, reaching full size as it becomes harvestable again.
        const grown = Math.max(0, 1 - n.regrowLeft / type.regrowSeconds);
        if (grown < TREES.stumpPortion) {
          d.scale.setScalar(TREES.stumpScale);
          d.updateMatrix();
          this.set(this.stump, slot, d.matrix);
          this.set(this.pine, slot, this.hidden);
          this.snow.setMatrixAt(slot, this.hidden);
        } else {
          const t = (grown - TREES.stumpPortion) / (1 - TREES.stumpPortion);
          const ease = 1 - (1 - t) ** 2;
          d.scale.setScalar(TREES.scale * (TREES.saplingMin + (1 - TREES.saplingMin) * ease));
          d.updateMatrix();
          this.set(this.pine, slot, d.matrix);
          this.snow.setMatrixAt(slot, d.matrix);
          this.set(this.stump, slot, this.hidden);
        }
      }
    });
    for (const m of [...this.pine, ...this.stump, this.snow]) {
      m.instanceMatrix.needsUpdate = true;
      // Stumps start hidden at scale 0; bounds must follow, or three.js culls them by stale ones.
      m.boundingSphere = null;
    }
  }
}
