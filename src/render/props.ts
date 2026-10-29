// Sell tables and the pads you stand on to use them.
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  RingGeometry,
  type Scene,
} from 'three';
import type { Content } from '../content';
import { COLORS } from './config';

interface PadView {
  x: number;
  z: number;
  material: MeshLambertMaterial;
}

function sellTable(): Group {
  const g = new Group();
  const legMat = new MeshLambertMaterial({ color: COLORS.table });
  const top = new Mesh(new BoxGeometry(1.2, 0.1, 0.8), new MeshLambertMaterial({ color: COLORS.tableTop }));
  top.position.y = 0.75;
  g.add(top);
  for (const [x, z] of [
    [-0.5, -0.32],
    [0.5, -0.32],
    [-0.5, 0.32],
    [0.5, 0.32],
  ] as const) {
    const leg = new Mesh(new BoxGeometry(0.1, 0.7, 0.1), legMat);
    leg.position.set(x, 0.35, z);
    g.add(leg);
  }
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

export class PropsView {
  private readonly pads: PadView[] = [];

  constructor(scene: Scene, private readonly content: Content) {
    for (const zone of content.zones) {
      for (const p of zone.props) {
        if (p.kind === 'sellTable') {
          const t = sellTable();
          t.position.set(p.x, 0, p.z);
          // Long side faces the nearest pad, where the player stands to sell.
          let nearest = zone.pads[0];
          for (const pad of zone.pads) {
            if (nearest && Math.hypot(pad.x - p.x, pad.z - p.z) < Math.hypot(nearest.x - p.x, nearest.z - p.z)) nearest = pad;
          }
          if (nearest) t.rotation.y = Math.atan2(nearest.x - p.x, nearest.z - p.z);
          scene.add(t);
        }
      }
      for (const pad of zone.pads) {
        const r = content.interaction.padRadius;
        const material = new MeshLambertMaterial({ color: COLORS.pad });
        const ring = new Mesh(new RingGeometry(r * 0.78, r, 32), material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pad.x, 0.01, pad.z);
        ring.receiveShadow = true;
        scene.add(ring);
        this.pads.push({ x: pad.x, z: pad.z, material });
      }
    }
  }

  /** Light up the pad the player is stopped on, matching when the sim transfers. */
  update(playerX: number, playerZ: number, stopped: boolean): void {
    const r = this.content.interaction.padRadius;
    for (const p of this.pads) {
      const on = stopped && Math.hypot(playerX - p.x, playerZ - p.z) <= r;
      p.material.color.setHex(on ? COLORS.padActive : COLORS.pad);
    }
  }
}
