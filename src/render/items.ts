// Draws carried and piled items as instanced meshes. Logs use the Kenney log
// model; every other item is a coloured board until it gets a model of its own.
// Callers place items in a unit box (1 x 1 x 1, long side along x) and scale
// the matrix to the size they want.
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { COLORS, ITEM_COLORS, MODEL_COLORS } from './config';
import type { Model } from './models';

/** Fits a model into the unit box, long side along x, centred on the origin. */
function unitGeometries(model: Model): Array<{ geometry: BufferGeometry; material: string }> {
  const { x, y, z } = model.size;
  // Kenney logs lie along z; turn them to run along x when that is their long side.
  const turn = z > x;
  const length = turn ? z : x;
  const depth = turn ? x : z;
  return model.parts.map((p) => {
    const g = p.geometry.clone();
    if (turn) g.rotateY(Math.PI / 2);
    g.translate(0, -y / 2, 0);
    g.applyMatrix4(new Matrix4().makeScale(1 / length, 1 / y, 1 / depth));
    return { geometry: g, material: p.material };
  });
}

export class ItemInstances {
  private readonly boards: InstancedMesh;
  private readonly logs: InstancedMesh[];
  private readonly color = new Color();
  private boardCount = 0;
  private logCount = 0;

  constructor(scene: Scene, log: Model, private readonly max: number) {
    this.boards = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), max);
    this.logs = unitGeometries(log).map(
      (p) => new InstancedMesh(p.geometry, new MeshLambertMaterial({ color: MODEL_COLORS[p.material] ?? COLORS.unknownItem }), max),
    );
    for (const m of [this.boards, ...this.logs]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      scene.add(m);
    }
  }

  begin(): void {
    this.boardCount = 0;
    this.logCount = 0;
  }

  /** Adds one item; false once full. */
  add(item: string, matrix: Matrix4): boolean {
    if (item === 'log') {
      if (this.logCount >= this.max) return false;
      for (const m of this.logs) m.setMatrixAt(this.logCount, matrix);
      this.logCount++;
      return true;
    }
    if (this.boardCount >= this.max) return false;
    this.boards.setMatrixAt(this.boardCount, matrix);
    this.boards.setColorAt(this.boardCount, this.color.setHex(ITEM_COLORS[item] ?? COLORS.unknownItem));
    this.boardCount++;
    return true;
  }

  end(): void {
    this.boards.count = this.boardCount;
    this.boards.instanceMatrix.needsUpdate = true;
    if (this.boards.instanceColor) this.boards.instanceColor.needsUpdate = true;
    for (const m of this.logs) {
      m.count = this.logCount;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
