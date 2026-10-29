// Sell tables, the Workbench, and the sell pads you stand on to use them.
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

/** A sturdy bench with a saw and a hammer on it. Front faces +z. */
function workbench(): Group {
  const g = new Group();
  const legMat = new MeshLambertMaterial({ color: COLORS.workbenchLeg });
  const top = new Mesh(new BoxGeometry(1.6, 0.14, 0.8), new MeshLambertMaterial({ color: COLORS.workbenchTop }));
  top.position.y = 0.8;
  g.add(top);
  for (const [x, z] of [
    [-0.7, -0.3],
    [0.7, -0.3],
    [-0.7, 0.3],
    [0.7, 0.3],
  ] as const) {
    const leg = new Mesh(new BoxGeometry(0.14, 0.75, 0.14), legMat);
    leg.position.set(x, 0.37, z);
    g.add(leg);
  }
  const toolMat = new MeshLambertMaterial({ color: COLORS.tool });
  const saw = new Mesh(new BoxGeometry(0.6, 0.02, 0.18), toolMat);
  saw.position.set(-0.35, 0.88, 0.05);
  saw.rotation.y = 0.3;
  const handle = new Mesh(new BoxGeometry(0.06, 0.06, 0.45), legMat);
  handle.position.set(0.4, 0.9, 0.05);
  handle.rotation.y = -0.4;
  const head = new Mesh(new BoxGeometry(0.22, 0.1, 0.1), toolMat);
  head.position.set(0.31, 0.92, 0.25);
  head.rotation.y = -0.4;
  g.add(saw, handle, head);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

export class PropsView {
  private readonly pads: PadView[] = [];
  /** Sell pad id to the top of the table it sells at. */
  readonly tableTops = new Map<string, { x: number; y: number; z: number }>();

  constructor(scene: Scene, private readonly content: Content) {
    for (const zone of content.zones) {
      for (const p of zone.props) {
        const t = p.kind === 'sellTable' ? sellTable() : workbench();
        t.position.set(p.x, 0, p.z);
        // Long side faces the nearest place the player stands to use it:
        // a sell pad for the table, an upgrade plot for the Workbench.
        const spots = p.kind === 'sellTable' ? zone.pads : zone.plots.filter((plot) => plot.kind === 'character');
        let nearest = spots[0];
        for (const s of spots) {
          if (nearest && Math.hypot(s.x - p.x, s.z - p.z) < Math.hypot(nearest.x - p.x, nearest.z - p.z)) nearest = s;
        }
        if (nearest) t.rotation.y = Math.atan2(nearest.x - p.x, nearest.z - p.z);
        scene.add(t);
        if (p.kind === 'sellTable' && nearest) this.tableTops.set(nearest.id, { x: p.x, y: 0.85, z: p.z });
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
