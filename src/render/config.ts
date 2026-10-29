// Engine settings: how the renderer runs, not how the game plays.
// Game and feel numbers belong in content.json instead.

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Half-width of the area the sun's shadow camera covers around the camera target. */
  shadowExtent: 20,
  shadowFar: 80,
  cameraDistance: 60,
  /** Shadows switch off if the first shadowProbeSeconds of play average under shadowMinFps. */
  shadowProbeSeconds: 10,
  shadowMinFps: 50,
  /** Longest frame the loop will simulate; longer gaps (tab switches) are dropped. */
  maxFrameSeconds: 0.25,
} as const;

// Placeholder lighting until day/night (phase 7) drives the sun from content.json.
export const LIGHTING = {
  hemiIntensity: 1.6,
  sunIntensity: 2.2,
  /** Sun offset from the camera target. */
  sunOffset: [-12, 30, 18],
} as const;

export const COLORS = {
  sky: 0xa8c8e0,
  snow: 0xf0f4f8,
  hemiGround: 0xc8d4dc,
  sun: 0xfff4e0,
  trunk: 0x6b4a2f,
  pine: 0x2f5d3a,
  pineSnow: 0xf4f8fb,
  table: 0x9a6b3f,
  tableTop: 0xb98552,
  pad: 0x5d6d7a,
  padActive: 0xf2c14e,
  plotDash: 0xffffff,
  sawmillBase: 0x7a5434,
  sawmillWall: 0xa8794a,
  sawmillRoof: 0x8c3b2e,
  workbenchTop: 0xb98552,
  workbenchLeg: 0x7a5434,
  farmerShirt: 0x3f6fb5,
  farmerPants: 0x40404a,
  farmerSkin: 0xf0c8a0,
  farmerHat: 0xb23028,
  tool: 0x8a8f96,
  unknownItem: 0x999999,
} as const;

/** Stack and world colours per item id. */
export const ITEM_COLORS: Record<string, number> = {
  log: 0x8b5a2b,
  plank: 0xe0b878,
};

/** Dashed plot rings and their labels. */
export const PLOTS = {
  dashes: 14,
  /** Fraction of each dash slot that is drawn. */
  dashFill: 0.6,
  /** Ring radii as fractions of the pad radius. */
  dashInner: 0.82,
  fillInner: 0.5,
  fillOuter: 0.74,
  fillSegments: 48,
  /** Labels this far off screen still render, so they slide in rather than pop. */
  labelMarginPx: 80,
  /** Height above the ground where the price label floats: over the farmer's head. */
  labelHeight: 2.3,
} as const;

/** Primitive building sizes and their build and fade animation. */
export const BUILDINGS = {
  /** Footprint as multiples of the machine's collision radius; 1.6 x 1.2 puts the corners on the circle. */
  footprint: { width: 1.6, depth: 1.2 },
  ghostOpacity: 0.3,
  popSeconds: 0.35,
  /** Overshoot of the pop-in (ease-out-back). */
  popOvershoot: 1.7,
  bladeTurnsPerCycle: 2,
  /** A building fades when the farmer is within this much of it sideways on screen, */
  fadeMargin: 0.6,
  /** or up to this far behind it (taller buildings hide more ground). */
  fadeReach: 2.6,
  fadeSpeed: 10,
} as const;

/** One item in a machine's pile. */
export const PILE = { length: 0.5, height: 0.15, depth: 0.15, perLayer: 3, iconSize: 0.45 } as const;

/** Placeholder farmer proportions until the glTF farmer lands. */
export const FARMER = {
  bodyRadius: 0.32,
  bodyLength: 0.55,
  headRadius: 0.22,
  /** Where the bottom of the carried stack sits, relative to the farmer's feet. */
  stackBaseHeight: 0.55,
  stackBackOffset: 0.42,
} as const;

/** Visual size of one stacked item: length across the back, depth. Height comes from content.feel. */
export const STACK_ITEM = { length: 0.55, depth: 0.2 } as const;
