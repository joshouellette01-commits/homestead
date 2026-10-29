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
};

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
