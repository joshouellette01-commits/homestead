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
  /** Opacity of a building standing between the camera and the farmer. */
  buildingFadeOpacity: number;
}

export interface ControlsContent {
  /** Diameter of the joystick ring; deadzone and fullSpeedAt are fractions of its radius. */
  joystickSizePx: number;
  /** Joystick deflection (0..1) below which the player stands still. */
  deadzone: number;
  /** Deflection at which the player reaches full walk speed. */
  fullSpeedAt: number;
}

/** Capacity, walk speed and swing time live in characterTracks, at level 0 to start. */
export interface PlayerContent {
  spawn: Vec2;
  radius: number;
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
  /** Seconds standing on a plot for the purchase ring to fill. */
  purchaseSeconds: number;
  /** Layout rule: nodes to their machine, and machines to the sell pad, within this many seconds of walking. */
  maxWalkSeconds: number;
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

export type PropKind = 'sellTable' | 'workbench';

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

export type TrackId = 'capacity' | 'walkSpeed' | 'swingSeconds';
export const TRACK_IDS: readonly TrackId[] = ['capacity', 'walkSpeed', 'swingSeconds'];

/** A character upgrade track: values[0] is the starting stat, costs[i] buys level i + 1. */
export interface TrackContent {
  values: number[];
  costs: number[];
}

/** A 1-input, 1-output machine. */
export interface MachineContent {
  name: string;
  input: string;
  output: string;
  cycleSeconds: number;
  /** Input and output piles each hold this many. */
  pileCapacity: number;
  /** Collision radius of the building. */
  radius: number;
}

/** Building speed upgrades, shared by every machine. */
export interface BuildingSpeedContent {
  levels: number;
  /** Cycle time is multiplied by this at each level. */
  cycleMultiplier: number;
  /** A level costs this many minutes of the income it adds, at sell prices. */
  costMinutes: number;
}

/** Where a machine stands once built, and its pads and piles. */
export interface SiteContent extends Vec2 {
  inputPad: Vec2;
  outputPad: Vec2;
  inputPile: Vec2;
  outputPile: Vec2;
}

/** A dashed plot that becomes a machine; once built, the same spot sells its speed upgrades. */
export interface BuildingPlotContent extends Vec2 {
  id: string;
  kind: 'building';
  machine: string;
  cash: number;
  /** Item id to count, carried in before the cash ring starts. */
  materials: Record<string, number>;
  site: SiteContent;
}

/** One of the Workbench's character upgrade plots. */
export interface CharacterPlotContent extends Vec2 {
  id: string;
  kind: 'character';
  track: TrackId;
}

export type PlotContent = BuildingPlotContent | CharacterPlotContent;

export interface ZoneContent {
  id: string;
  name: string;
  gateCost: number;
  bounds: Bounds;
  nodes: NodeContent[];
  props: PropContent[];
  pads: PadContent[];
  plots: PlotContent[];
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
  characterTracks: Record<TrackId, TrackContent>;
  machines: Record<string, MachineContent>;
  buildingSpeed: BuildingSpeedContent;
  zones: ZoneContent[];
}
