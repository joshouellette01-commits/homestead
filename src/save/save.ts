// Moves game state in and out of localStorage. Never wipes a save on its own:
// a save that fails to load is reported as corrupt and left untouched.
import type { Content } from '../content';
import type { SimState } from '../sim/state';
import { SaveTooNewError, migrate } from './migrate';
import { SAVE_KEY, SAVE_VERSION, type SaveData } from './schema';

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'ok'; data: SaveData }
  | { kind: 'newer'; error: string }
  | { kind: 'corrupt'; error: string };

/** localStorage, or null when the browser refuses access (private mode, blocked storage). */
export function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSave(storage: Storage | null): LoadResult {
  if (!storage) return { kind: 'none' };
  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'none' };
  }
  if (text === null) return { kind: 'none' };
  try {
    return { kind: 'ok', data: migrate(JSON.parse(text)) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return e instanceof SaveTooNewError ? { kind: 'newer', error } : { kind: 'corrupt', error };
  }
}

export function writeSave(storage: Storage | null, data: SaveData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: Storage | null): void {
  try {
    storage?.removeItem(SAVE_KEY);
  } catch {
    // Nothing more to do; the next write replaces it anyway.
  }
}

export function toSave(s: SimState, settings: Record<string, unknown> = {}): SaveData {
  const nodes: SaveData['nodes'] = {};
  for (const n of s.nodes) nodes[n.id] = { remaining: n.remaining, regrowLeft: n.regrowLeft };
  return {
    version: SAVE_VERSION,
    cash: s.cash,
    playTime: s.time,
    player: { x: s.player.x, z: s.player.z, stack: [...s.player.stack] },
    nodes,
    settings,
  };
}

/** Apply a save onto a fresh state, ignoring anything content.json no longer has. */
export function applySave(s: SimState, data: SaveData, c: Content): void {
  s.cash = data.cash;
  s.time = data.playTime;
  s.player.x = data.player.x;
  s.player.z = data.player.z;
  s.player.stack = data.player.stack.filter((item) => Object.hasOwn(c.items, item)).slice(0, c.player.capacity);
  for (const n of s.nodes) {
    const saved = data.nodes[n.id];
    const type = c.nodeTypes[n.type];
    if (!saved || !type) continue;
    n.remaining = Math.max(0, Math.min(type.yield, Math.round(saved.remaining)));
    n.regrowLeft = n.remaining > 0 ? 0 : Math.max(0, Math.min(type.regrowSeconds, saved.regrowLeft));
  }
}
