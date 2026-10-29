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

export interface ControlsContent {
  /** Diameter of the joystick ring; deadzone and fullSpeedAt are fractions of its radius. */
  joystickSizePx: number;
  /** Joystick deflection (0..1) below which the player stands still. */
  deadzone: number;
  /** Deflection at which the player reaches full walk speed. */
  fullSpeedAt: number;
}

export interface PlayerContent {
  spawn: Vec2;
  radius: number;
  capacity: number;
  walkSpeed: number;
  swingSeconds: number;
}

/** Look-and-feel numbers tuned on the phone in phase 2. */
export interface FeelContent {
  stackItemHeight: number;
  stackSwayStiffness: number;
  stackSwayDamping: number;
  /** Sway at the top of the stack per unit of walk speed, before the spring. */
  stackSwayPerSpeed: number;
  stackSwayMax: number;
  /** How fast the farmer turns to face a new heading (per second, exponential). */
  turnSpeed: number;
  walkBobHeight: number;
  /** Bob phase advanced per unit walked. */
  walkBobPerUnit: number;
  treeShakeSeconds: number;
  treeShakeAngle: number;
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
  id: string;
  type: string;
}

export type PropKind = 'sellTable';

/** A solid object the player walks around. */
export interface PropContent extends Vec2 {
  id: string;
  kind: PropKind;
  radius: number;
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
  props: PropContent[];
  pads: PadContent[];
}

export interface Content {
  contentVersion: number;
  world: { width: number; depth: number };
  camera: CameraContent;
  controls: ControlsContent;
  player: PlayerContent;
  feel: FeelContent;
  interaction: InteractionContent;
  items: Record<string, ItemContent>;
  nodeTypes: Record<string, NodeTypeContent>;
  zones: ZoneContent[];
}
