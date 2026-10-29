// Engine settings: how the renderer runs, not how the game plays.
// Game and feel numbers belong in content.json instead.

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Half-width of the area the sun's shadow camera covers. */
  shadowExtent: 20,
  shadowFar: 80,
  cameraDistance: 60,
} as const;

// Placeholder lighting until day/night (phase 7) drives the sun from content.json.
export const LIGHTING = {
  hemiIntensity: 1.6,
  sunIntensity: 2.2,
  sunPosition: [-12, 30, 18],
} as const;

export const COLORS = {
  sky: 0xa8c8e0,
  snow: 0xf0f4f8,
  hemiGround: 0xc8d4dc,
  sun: 0xfff4e0,
  marker: 0xb23028,
} as const;
