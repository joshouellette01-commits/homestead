import { describe, expect, it } from 'vitest';
import { content as c } from '../content';
import { createState } from '../sim/state';
import { SaveError, migrate } from './migrate';
import { applySave, readSave, toSave, writeSave } from './save';
import { SAVE_KEY, SAVE_VERSION } from './schema';

/** Every old save shape we have ever shipped; each must still load. */
const fixtures = import.meta.glob<{ default: unknown }>('./fixtures/*.json', { eager: true });

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('save fixtures', () => {
  it('has a fixture for the current version', () => {
    expect(Object.keys(fixtures)).toContain(`./fixtures/v${SAVE_VERSION}.json`);
  });

  for (const [path, mod] of Object.entries(fixtures)) {
    it(`loads ${path} and applies it to content.json`, () => {
      const data = migrate(mod.default);
      expect(data.version).toBe(SAVE_VERSION);
      const s = createState(c);
      applySave(s, data, c);
      expect(Number.isFinite(s.cash)).toBe(true);
    });
  }
});

describe('migrations keep what they carry', () => {
  it("v2 keeps the Sawmill's level and logs", () => {
    const data = migrate(fixtures['./fixtures/v2.json']?.default);
    expect(data.buildings['yard-sawmill']).toMatchObject({ built: true, level: 1, inputs: { log: 12 }, output: 7 });
  });

  it('v3 restores owned zones', () => {
    const s = createState(c);
    applySave(s, migrate(fixtures['./fixtures/v3.json']?.default), c);
    expect(s.zones).toMatchObject({ yard: true, field: true, coop: false });
  });
});

describe('round trip', () => {
  it('restores what it saved', () => {
    const s = createState(c);
    s.cash = 17;
    s.time = 99;
    s.player.x = 2;
    s.player.stack = ['log', 'log'];
    s.nodes[0]!.remaining = 0;
    s.nodes[0]!.regrowLeft = 7;

    const storage = memoryStorage();
    expect(writeSave(storage, toSave(s))).toBe(true);
    const loaded = readSave(storage);
    if (loaded.kind !== 'ok') throw new Error(`expected ok, got ${loaded.kind}`);

    const t = createState(c);
    applySave(t, loaded.data, c);
    expect(t.cash).toBe(17);
    expect(t.time).toBe(99);
    expect(t.player.x).toBe(2);
    expect(t.player.stack).toEqual(['log', 'log']);
    expect(t.nodes[0]).toMatchObject({ remaining: 0, regrowLeft: 7 });
  });

  it('keeps plots inert after loading a save taken while standing on one', () => {
    const plot = c.zones[0]!.plots.find((p) => p.kind === 'character')!;
    const s = createState(c);
    s.player.x = plot.x;
    s.player.z = plot.z;
    s.cash = 100000;
    const t = createState(c);
    applySave(t, toSave(s), c);
    expect(t.purchase.locked).toBe(true);
  });

  it('clamps negative cash and play time', () => {
    const s = createState(c);
    const data = toSave(s);
    data.cash = -50;
    data.playTime = -1;
    applySave(s, data, c);
    expect(s.cash).toBe(0);
    expect(s.time).toBe(0);
  });

  it('drops items and nodes content.json no longer has', () => {
    const s = createState(c);
    const data = toSave(s);
    data.player.stack = ['log', 'unobtainium'];
    data.nodes['gone-tree'] = { remaining: 1, regrowLeft: 0 };
    applySave(s, data, c);
    expect(s.player.stack).toEqual(['log']);
  });
});

describe('corrupt saves', () => {
  it('reports unparseable JSON as corrupt and leaves it in storage', () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{not json' });
    expect(readSave(storage).kind).toBe('corrupt');
    expect(storage.getItem(SAVE_KEY)).toBe('{not json');
  });

  it('reports a wrong shape as corrupt', () => {
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify({ version: 1, cash: 'lots' }) });
    expect(readSave(storage).kind).toBe('corrupt');
  });

  it('refuses a save from a newer build', () => {
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(SaveError);
  });

  it('reports a newer save as newer, not corrupt, and leaves it in storage', () => {
    const text = JSON.stringify({ version: SAVE_VERSION + 1 });
    const storage = memoryStorage({ [SAVE_KEY]: text });
    expect(readSave(storage).kind).toBe('newer');
    expect(storage.getItem(SAVE_KEY)).toBe(text);
  });

  it('treats an empty slot as no save', () => {
    expect(readSave(memoryStorage()).kind).toBe('none');
  });
});
