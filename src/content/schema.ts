// Shape of content.json. Every game number lives in that file; these types
// describe it, and load.ts checks the file against them at startup.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CameraContent {
  /** Degrees below horizontal. */
  pitchDeg: number;
  /** Rotation around the vertical axis; 45 gives the isometric diagonal. */
  yawDeg: number;
  /** World units visible across the shorter side of the screen. */
  viewSize: number;
  followLerpSeconds: number;
}

export interface PlayerContent {
  spawn: Vec2;
  radius: number;
  capacity: number;
  walkSpeed: number;
  swingSeconds: number;
}

export interface InteractionContent {
  padRadius: number;
  transferPerSecond: number;
  minPadSpacing: number;
  minUpgradePlotToInputPadSpacing: number;
}

export type ItemKind = 'raw' | 'processed' | 'feed';

export interface ItemContent {
  name: string;
  kind: ItemKind;
  sellPrice: number;
}

export interface NodeTypeContent {
  item: string;
  yield: number;
  regrowSeconds: number;
  radius: number;
  harvestRange: number;
}

export interface NodeContent extends Vec2 {
  type: string;
}

export type PadKind = 'sell';

export interface PadContent extends Vec2 {
  id: string;
  kind: PadKind;
}

export interface ZoneContent {
  id: string;
  name: string;
  gateCost: number;
  bounds: Bounds;
  nodes: NodeContent[];
  pads: PadContent[];
}

export interface Content {
  contentVersion: number;
  world: { width: number; depth: number };
  camera: CameraContent;
  player: PlayerContent;
  interaction: InteractionContent;
  items: Record<string, ItemContent>;
  nodeTypes: Record<string, NodeTypeContent>;
  zones: ZoneContent[];
}
