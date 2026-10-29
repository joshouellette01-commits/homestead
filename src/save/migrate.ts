// Turns whatever is in storage into the current SaveData, or throws SaveError.
import { SAVE_VERSION, type BuildingSave, type NodeSave, type SaveData } from './schema';

export class SaveError extends Error {
  override name = 'SaveError';
}

/** A valid save written by a newer build; never offer to reset it. */
export class SaveTooNewError extends SaveError {
  override name = 'SaveTooNewError';
}

type Raw = Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a version-n save to version n + 1. Add one per
 * SAVE_VERSION bump, with a fixture of the old shape in fixtures/.
 */
export const MIGRATIONS: Record<number, (save: Raw) => Raw> = {
  // v2 (phase 3): character upgrade levels and building plots, none bought yet.
  1: (save) => ({ ...save, levels: {}, buildings: {} }),
  // v3 (phase 4): zone gates, and machines with several inputs. Every v2
  // building was the Sawmill, whose only input is logs; speedLevel became level.
  2: (save) => {
    const buildings: Raw = {};
    const old = isObj(save.buildings) ? save.buildings : {};
    for (const [id, b] of Object.entries(old)) {
      if (!isObj(b)) {
        buildings[id] = b;
        continue;
      }
      const { speedLevel, input, ...rest } = b;
      buildings[id] = { ...rest, level: speedLevel, inputs: { log: input } };
    }
    return { ...save, buildings, zones: {} };
  },
};

function isObj(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SaveError(`${path}: expected a number`);
  return v;
}

function validate(raw: Raw): SaveData {
  const player = raw.player;
  if (!isObj(player)) throw new SaveError('player: expected an object');
  const stack = player.stack;
  if (!isStringArray(stack)) {
    throw new SaveError('player.stack: expected an array of strings');
  }
  if (!isObj(raw.nodes)) throw new SaveError('nodes: expected an object');
  const nodes: Record<string, NodeSave> = {};
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (!isObj(n)) throw new SaveError(`nodes.${id}: expected an object`);
    nodes[id] = {
      remaining: finite(n.remaining, `nodes.${id}.remaining`),
      regrowLeft: finite(n.regrowLeft, `nodes.${id}.regrowLeft`),
    };
  }
  if (!isObj(raw.levels)) throw new SaveError('levels: expected an object');
  const levels: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw.levels)) levels[id] = finite(v, `levels.${id}`);
  if (!isObj(raw.buildings)) throw new SaveError('buildings: expected an object');
  const buildings: Record<string, BuildingSave> = {};
  for (const [id, b] of Object.entries(raw.buildings)) {
    const path = `buildings.${id}`;
    if (!isObj(b)) throw new SaveError(`${path}: expected an object`);
    if (typeof b.built !== 'boolean') throw new SaveError(`${path}.built: expected a boolean`);
    if (!isObj(b.delivered)) throw new SaveError(`${path}.delivered: expected an object`);
    const delivered: Record<string, number> = {};
    for (const [item, n] of Object.entries(b.delivered)) delivered[item] = finite(n, `${path}.delivered.${item}`);
    if (!isObj(b.inputs)) throw new SaveError(`${path}.inputs: expected an object`);
    const inputs: Record<string, number> = {};
    for (const [item, n] of Object.entries(b.inputs)) inputs[item] = finite(n, `${path}.inputs.${item}`);
    buildings[id] = {
      built: b.built,
      delivered,
      level: finite(b.level, `${path}.level`),
      inputs,
      output: finite(b.output, `${path}.output`),
    };
  }
  if (!isObj(raw.zones)) throw new SaveError('zones: expected an object');
  const zones: Record<string, boolean> = {};
  for (const [id, owned] of Object.entries(raw.zones)) {
    if (typeof owned !== 'boolean') throw new SaveError(`zones.${id}: expected true or false`);
    zones[id] = owned;
  }
  const settings = raw.settings ?? {};
  if (!isObj(settings)) throw new SaveError('settings: expected an object');
  return {
    version: SAVE_VERSION,
    cash: finite(raw.cash, 'cash'),
    playTime: finite(raw.playTime, 'playTime'),
    player: { x: finite(player.x, 'player.x'), z: finite(player.z, 'player.z'), stack },
    nodes,
    levels,
    zones,
    buildings,
    settings,
  };
}

export function migrate(input: unknown): SaveData {
  if (!isObj(input)) throw new SaveError('save is not an object');
  let raw = input;
  let version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveError('missing or invalid version');
  }
  if (version > SAVE_VERSION) throw new SaveTooNewError(`save is version ${version}, newer than this build (${SAVE_VERSION})`);
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new SaveError(`no migration from version ${version}`);
    raw = step(raw);
    version += 1;
    raw.version = version;
  }
  return validate(raw);
}
