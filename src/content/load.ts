// Checks raw JSON against the Content schema so a typo in content.json fails
// loudly at startup (and in tests) instead of surfacing as NaN mid-game.
import type {
  Bounds,
  CameraContent,
  Content,
  ControlsContent,
  FeelContent,
  InteractionContent,
  ItemContent,
  ItemKind,
  NodeContent,
  NodeTypeContent,
  PadContent,
  PadKind,
  PlayerContent,
  PropContent,
  PropKind,
  Vec2,
  ZoneContent,
} from './schema';

export class ContentError extends Error {
  override name = 'ContentError';
}

type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ContentError(`content.json ${path}: ${message}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Obj;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function num(o: Obj, key: string, path: string, opts: { min?: number; int?: boolean } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'expected a number');
  if (opts.int && !Number.isInteger(v)) fail(`${path}.${key}`, 'expected an integer');
  if (opts.min !== undefined && v < opts.min) fail(`${path}.${key}`, `must be >= ${opts.min}`);
  return v;
}

function positive(o: Obj, key: string, path: string): number {
  const v = num(o, key, path);
  if (v <= 0) fail(`${path}.${key}`, 'must be > 0');
  return v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(`${path}.${key}`, 'expected a non-empty string');
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, path: string, options: readonly T[]): T {
  const v = str(o, key, path);
  if (!(options as readonly string[]).includes(v)) {
    fail(`${path}.${key}`, `expected one of ${options.join(', ')}`);
  }
  return v as T;
}

function record<T>(value: unknown, path: string, parse: (v: unknown, path: string) => T): Record<string, T> {
  const o = obj(value, path);
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o)) out[k] = parse(v, `${path}.${k}`);
  return out;
}

function vec2(value: unknown, path: string): Vec2 {
  const o = obj(value, path);
  return { x: num(o, 'x', path), z: num(o, 'z', path) };
}

function bounds(value: unknown, path: string): Bounds {
  const o = obj(value, path);
  const b = {
    minX: num(o, 'minX', path),
    maxX: num(o, 'maxX', path),
    minZ: num(o, 'minZ', path),
    maxZ: num(o, 'maxZ', path),
  };
  if (b.minX >= b.maxX || b.minZ >= b.maxZ) fail(path, 'min must be less than max');
  return b;
}

function camera(value: unknown, path: string): CameraContent {
  const o = obj(value, path);
  return {
    pitchDeg: positive(o, 'pitchDeg', path),
    yawDeg: num(o, 'yawDeg', path),
    viewSize: positive(o, 'viewSize', path),
    followLerpSeconds: num(o, 'followLerpSeconds', path, { min: 0 }),
  };
}

function controls(value: unknown, path: string): ControlsContent {
  const o = obj(value, path);
  const c = {
    deadzone: num(o, 'deadzone', path, { min: 0 }),
    fullSpeedAt: positive(o, 'fullSpeedAt', path),
  };
  if (c.fullSpeedAt <= c.deadzone || c.fullSpeedAt > 1) fail(path, 'need deadzone < fullSpeedAt <= 1');
  return c;
}

function feel(value: unknown, path: string): FeelContent {
  const o = obj(value, path);
  return {
    stackItemHeight: positive(o, 'stackItemHeight', path),
    stackSwayStiffness: positive(o, 'stackSwayStiffness', path),
    stackSwayDamping: num(o, 'stackSwayDamping', path, { min: 0 }),
    stackSwayPerSpeed: num(o, 'stackSwayPerSpeed', path, { min: 0 }),
    stackSwayMax: num(o, 'stackSwayMax', path, { min: 0 }),
  };
}

function player(value: unknown, path: string): PlayerContent {
  const o = obj(value, path);
  return {
    spawn: vec2(o.spawn, `${path}.spawn`),
    radius: positive(o, 'radius', path),
    capacity: num(o, 'capacity', path, { min: 1, int: true }),
    walkSpeed: positive(o, 'walkSpeed', path),
    swingSeconds: positive(o, 'swingSeconds', path),
  };
}

function interaction(value: unknown, path: string): InteractionContent {
  const o = obj(value, path);
  return {
    padRadius: positive(o, 'padRadius', path),
    transferPerSecond: positive(o, 'transferPerSecond', path),
    minPadSpacing: positive(o, 'minPadSpacing', path),
    minUpgradePlotToInputPadSpacing: positive(o, 'minUpgradePlotToInputPadSpacing', path),
  };
}

const ITEM_KINDS: readonly ItemKind[] = ['raw', 'processed', 'feed'];
const PAD_KINDS: readonly PadKind[] = ['sell'];
const PROP_KINDS: readonly PropKind[] = ['sellTable'];

function item(value: unknown, path: string): ItemContent {
  const o = obj(value, path);
  return {
    name: str(o, 'name', path),
    kind: oneOf(o, 'kind', path, ITEM_KINDS),
    sellPrice: num(o, 'sellPrice', path, { min: 0 }),
  };
}

function nodeType(value: unknown, path: string): NodeTypeContent {
  const o = obj(value, path);
  return {
    item: str(o, 'item', path),
    yield: num(o, 'yield', path, { min: 1, int: true }),
    regrowSeconds: positive(o, 'regrowSeconds', path),
    radius: positive(o, 'radius', path),
    harvestRange: positive(o, 'harvestRange', path),
  };
}

function node(value: unknown, path: string): NodeContent {
  const o = obj(value, path);
  return { id: str(o, 'id', path), type: str(o, 'type', path), ...vec2(o, path) };
}

function prop(value: unknown, path: string): PropContent {
  const o = obj(value, path);
  return {
    id: str(o, 'id', path),
    kind: oneOf(o, 'kind', path, PROP_KINDS),
    radius: positive(o, 'radius', path),
    ...vec2(o, path),
  };
}

function pad(value: unknown, path: string): PadContent {
  const o = obj(value, path);
  return { id: str(o, 'id', path), kind: oneOf(o, 'kind', path, PAD_KINDS), ...vec2(o, path) };
}

function zone(value: unknown, path: string): ZoneContent {
  const o = obj(value, path);
  return {
    id: str(o, 'id', path),
    name: str(o, 'name', path),
    gateCost: num(o, 'gateCost', path, { min: 0 }),
    bounds: bounds(o.bounds, `${path}.bounds`),
    nodes: arr(o.nodes, `${path}.nodes`).map((n, i) => node(n, `${path}.nodes[${i}]`)),
    props: arr(o.props, `${path}.props`).map((p, i) => prop(p, `${path}.props[${i}]`)),
    pads: arr(o.pads, `${path}.pads`).map((p, i) => pad(p, `${path}.pads[${i}]`)),
  };
}

/** Cross-references that the per-field checks cannot see. */
function checkReferences(c: Content): void {
  for (const [id, nt] of Object.entries(c.nodeTypes)) {
    if (!c.items[nt.item]) fail(`nodeTypes.${id}.item`, `unknown item "${nt.item}"`);
  }
  const zoneIds = new Set<string>();
  const objectIds = new Set<string>();
  const claimId = (id: string, path: string): void => {
    if (objectIds.has(id)) fail(path, `duplicate id "${id}"`);
    objectIds.add(id);
  };
  c.zones.forEach((z, zi) => {
    if (zoneIds.has(z.id)) fail(`zones[${zi}].id`, `duplicate zone id "${z.id}"`);
    zoneIds.add(z.id);
    z.nodes.forEach((n, ni) => {
      claimId(n.id, `zones[${zi}].nodes[${ni}].id`);
      if (!c.nodeTypes[n.type]) fail(`zones[${zi}].nodes[${ni}].type`, `unknown node type "${n.type}"`);
    });
    z.props.forEach((p, pi) => claimId(p.id, `zones[${zi}].props[${pi}].id`));
    z.pads.forEach((p, pi) => claimId(p.id, `zones[${zi}].pads[${pi}].id`));
  });
}

export function parseContent(raw: unknown): Content {
  const o = obj(raw, '(root)');
  const world = obj(o.world, 'world');
  const content: Content = {
    contentVersion: num(o, 'contentVersion', '(root)', { min: 1, int: true }),
    world: { width: positive(world, 'width', 'world'), depth: positive(world, 'depth', 'world') },
    camera: camera(o.camera, 'camera'),
    controls: controls(o.controls, 'controls'),
    player: player(o.player, 'player'),
    feel: feel(o.feel, 'feel'),
    interaction: interaction(o.interaction, 'interaction'),
    items: record(o.items, 'items', item),
    nodeTypes: record(o.nodeTypes, 'nodeTypes', nodeType),
    zones: arr(o.zones, 'zones').map((z, i) => zone(z, `zones[${i}]`)),
  };
  checkReferences(content);
  return content;
}
