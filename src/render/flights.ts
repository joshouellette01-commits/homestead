// Items flying in an arc between the farmer's stack and a pile, plot or table,
// so every load and unload is visible. The sim moves items instantly; views
// hold back arrivals until their flight lands.
import { Object3D, Vector3, type Scene } from 'three';
import type { Content } from '../content';
import { STACK_ITEM } from './config';
import { ItemInstances } from './items';
import type { Model } from './models';

interface Flight {
  item: string;
  from: Vector3;
  to: Vector3;
  yawFrom: number;
  yawTo: number;
  age: number;
  onLand: (() => void) | null;
}

/** More than can be in the air at once at transferPerSecond. */
const MAX_FLIGHTS = 64;

export class FlightsView {
  private readonly items: ItemInstances;
  private flights: Flight[] = [];
  private readonly dummy = new Object3D();

  constructor(
    scene: Scene,
    log: Model,
    private readonly content: Content,
  ) {
    this.items = new ItemInstances(scene, log, MAX_FLIGHTS);
  }

  launch(item: string, from: Vector3, to: Vector3, yawFrom: number, yawTo: number, onLand: (() => void) | null = null): void {
    if (this.flights.length >= MAX_FLIGHTS) {
      onLand?.();
      return;
    }
    this.flights.push({ item, from: from.clone(), to: to.clone(), yawFrom, yawTo, age: 0, onLand });
  }

  update(dt: number): void {
    const { transferFlightSeconds, transferArcHeight } = this.content.feel;
    const d = this.dummy;
    this.items.begin();
    const flying: Flight[] = [];
    for (const f of this.flights) {
      f.age += dt;
      const t = Math.min(1, f.age / transferFlightSeconds);
      if (t >= 1) {
        f.onLand?.();
        continue;
      }
      flying.push(f);
      d.position.lerpVectors(f.from, f.to, t);
      d.position.y += Math.sin(Math.PI * t) * transferArcHeight;
      d.rotation.set(0, f.yawFrom + (f.yawTo - f.yawFrom) * t, 0);
      d.scale.set(STACK_ITEM.length, this.content.feel.stackItemHeight * 0.92, STACK_ITEM.depth);
      d.updateMatrix();
      this.items.add(f.item, d.matrix);
    }
    this.flights = flying;
    this.items.end();
  }
}
