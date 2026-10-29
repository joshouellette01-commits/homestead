// Game state for the simulation. Pure data: no three.js, no DOM, so the
// renderer and the headless balance simulator run the same rules.
import type { Content, TrackId } from '../content';

export interface NodeState {
  id: string;
  type: string;
  /** Zone the node stands in; it can only be reached once that zone is owned. */
  zone: string;
  x: number;
  z: number;
  /** Items left before the node needs to regrow. */
  remaining: number;
  /** Seconds until a depleted node is full again; 0 while not depleted. */
  regrowLeft: number;
}

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Heading in radians around the vertical axis; 0 faces +z. */
  facing: number;
  /** Item ids, bottom first; the last entry is the top of the stack. */
  stack: string[];
  swingTimer: number;
  /** Index into SimState.nodes of the node being harvested, or -1. */
  harvesting: number;
  transferTimer: number;
}

/** A building plot and, once built, its machine. One per building plot in content.json, in order. */
export interface BuildingState {
  plotId: string;
  built: boolean;
  /** Materials carried into the plot so far, by item id. */
  delivered: Record<string, number>;
  /** Speed level for processors, herd level for animal buildings. */
  level: number;
  /** Items waiting in each input pile (or trough) that the building owns, by item id. */
  inputs: Record<string, number>;
  /** Items finished in the output pile. */
  output: number;
  /** Seconds into the current cycle. */
  cycle: number;
}

/** The purchase ring on whatever plot the player stands on. */
export interface PurchaseState {
  /** Pad id the ring is filling on, or null. */
  pad: string | null;
  progress: number;
  /** Set by a purchase; plots stay inert until the player steps off every pad, so one visit buys one level. */
  locked: boolean;
}

export interface SimState {
  /** Seconds of play; only advances while the game is open. */
  time: number;
  cash: number;
  player: PlayerState;
  nodes: NodeState[];
  levels: Record<TrackId, number>;
  /** Owned zones by id; free zones start owned. */
  zones: Record<string, boolean>;
  buildings: BuildingState[];
  purchase: PurchaseState;
}

/** Joystick deflection in world space, magnitude 0..1. */
export interface SimInput {
  x: number;
  z: number;
}

export const NO_INPUT: SimInput = { x: 0, z: 0 };

export function createState(c: Content): SimState {
  const nodes: NodeState[] = [];
  for (const zone of c.zones) {
    for (const n of zone.nodes) {
      const type = c.nodeTypes[n.type];
      if (!type) throw new Error(`unknown node type ${n.type}`);
      nodes.push({ id: n.id, type: n.type, zone: zone.id, x: n.x, z: n.z, remaining: type.yield, regrowLeft: 0 });
    }
  }
  const buildings: BuildingState[] = [];
  for (const zone of c.zones) {
    for (const plot of zone.plots) {
      if (plot.kind !== 'building') continue;
      buildings.push({ plotId: plot.id, built: false, delivered: {}, level: 0, inputs: {}, output: 0, cycle: 0 });
    }
  }
  return {
    time: 0,
    cash: 0,
    player: {
      x: c.player.spawn.x,
      z: c.player.spawn.z,
      vx: 0,
      vz: 0,
      facing: 0,
      stack: [],
      swingTimer: 0,
      harvesting: -1,
      transferTimer: 0,
    },
    nodes,
    levels: { capacity: 0, walkSpeed: 0, swingSeconds: 0 },
    zones: Object.fromEntries(c.zones.map((z) => [z.id, z.gateCost === 0])),
    buildings,
    purchase: { pad: null, progress: 0, locked: false },
  };
}
