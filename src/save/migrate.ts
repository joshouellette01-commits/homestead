// Turns whatever is in storage into the current SaveData, or throws SaveError.
import { SAVE_VERSION, type NodeSave, type SaveData } from './schema';

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
export const MIGRATIONS: Record<number, (save: Raw) => Raw> = {};

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
  const settings = raw.settings ?? {};
  if (!isObj(settings)) throw new SaveError('settings: expected an object');
  return {
    version: SAVE_VERSION,
    cash: finite(raw.cash, 'cash'),
    playTime: finite(raw.playTime, 'playTime'),
    player: { x: finite(player.x, 'player.x'), z: finite(player.z, 'player.z'), stack },
    nodes,
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
