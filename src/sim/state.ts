// Game state for the simulation. Pure data: no three.js, no DOM, so the
// renderer and the headless balance simulator run the same rules.
import type { Content } from '../content';

export interface NodeState {
  id: string;
  type: string;
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

export interface SimState {
  /** Seconds of play; only advances while the game is open. */
  time: number;
  cash: number;
  player: PlayerState;
  nodes: NodeState[];
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
      nodes.push({ id: n.id, type: n.type, x: n.x, z: n.z, remaining: type.yield, regrowLeft: 0 });
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
  };
}
