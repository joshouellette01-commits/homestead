// The save format. Bump SAVE_VERSION whenever this shape changes, add a
// migration in migrate.ts, and add a fixture of the old shape under fixtures/.

export const SAVE_KEY = 'homestead.save';
export const SAVE_VERSION = 1;

export interface NodeSave {
  remaining: number;
  regrowLeft: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  cash: number;
  playTime: number;
  player: {
    x: number;
    z: number;
    /** Bottom first. Not in DESIGN.md's saved list; added with approval in phase 2. */
    stack: string[];
  };
  /** Keyed by node id from content.json. */
  nodes: Record<string, NodeSave>;
  settings: Record<string, unknown>;
}
