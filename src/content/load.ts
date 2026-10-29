// Checks raw JSON against the Content schema so a typo in content.json fails
// loudly at startup (and in tests) instead of surfacing as NaN mid-game.
import {
  TRACK_IDS,
  type BuildingPlotContent,
  type BuildingSpeedContent,
  type CharacterPlotContent,
  type GatePlotContent,
  type HerdUpgradeContent,
  type InputSiteContent,
  type MachineContent,
  type PlotContent,
  type SiteContent,
  type TrackContent,
  type TrackId,
} from './schema';
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

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'expected true or false');
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
    buildingFadeOpacity: num(o, 'buildingFadeOpacity', path, { min: 0 }),
  };
}

function controls(value: unknown, path: string): ControlsContent {
  const o = obj(value, path);
  const c = {
    joystickSizePx: positive(o, 'joystickSizePx', path),
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
    turnSpeed: positive(o, 'turnSpeed', path),
    walkBobHeight: num(o, 'walkBobHeight', path, { min: 0 }),
    walkBobPerUnit: num(o, 'walkBobPerUnit', path, { min: 0 }),
    treeShakeSeconds: positive(o, 'treeShakeSeconds', path),
    treeShakeAngle: num(o, 'treeShakeAngle', path, { min: 0 }),
    transferFlightSeconds: positive(o, 'transferFlightSeconds', path),
    transferArcHeight: num(o, 'transferArcHeight', path, { min: 0 }),
  };
}

function player(value: unknown, path: string): PlayerContent {
  const o = obj(value, path);
  return {
    spawn: vec2(o.spawn, `${path}.spawn`),
    radius: positive(o, 'radius', path),
  };
}

function interaction(value: unknown, path: string): InteractionContent {
  const o = obj(value, path);
  return {
    padRadius: positive(o, 'padRadius', path),
    transferPerSecond: positive(o, 'transferPerSecond', path),
    minPadSpacing: positive(o, 'minPadSpacing', path),
    minUpgradePlotToInputPadSpacing: positive(o, 'minUpgradePlotToInputPadSpacing', path),
    purchaseSeconds: positive(o, 'purchaseSeconds', path),
    maxWalkSeconds: positive(o, 'maxWalkSeconds', path),
  };
}

const ITEM_KINDS: readonly ItemKind[] = ['raw', 'processed', 'feed'];
const PAD_KINDS: readonly PadKind[] = ['sell'];
const PROP_KINDS: readonly PropKind[] = ['sellTable', 'workbench'];
const PLOT_KINDS = ['building', 'character', 'gate'] as const;
const MACHINE_KINDS = ['processor', 'animals'] as const;

function numbers(value: unknown, path: string, check: (v: number, path: string) => void): number[] {
  return arr(value, path).map((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}[${i}]`, 'expected a number');
    check(v, `${path}[${i}]`);
    return v;
  });
}

function track(value: unknown, path: string, id: TrackId): TrackContent {
  const o = obj(value, path);
  const values = numbers(o.values, `${path}.values`, (v, p) => {
    if (v <= 0) fail(p, 'must be > 0');
    if (id === 'capacity' && !Number.isInteger(v)) fail(p, 'expected an integer');
  });
  const costs = numbers(o.costs, `${path}.costs`, (v, p) => {
    if (v < 0) fail(p, 'must be >= 0');
  });
  if (values.length < 1) fail(`${path}.values`, 'needs at least the starting value');
  if (costs.length !== values.length - 1) fail(`${path}.costs`, `needs one cost per level above 0 (${values.length - 1})`);
  return { values, costs };
}

function characterTracks(value: unknown, path: string): Record<TrackId, TrackContent> {
  const o = obj(value, path);
  const t = (id: TrackId): TrackContent => track(o[id], `${path}.${id}`, id);
  return { capacity: t('capacity'), walkSpeed: t('walkSpeed'), swingSeconds: t('swingSeconds') };
}

function machine(value: unknown, path: string): MachineContent {
  const o = obj(value, path);
  const kind = oneOf(o, 'kind', path, MACHINE_KINDS);
  const common = {
    name: str(o, 'name', path),
    output: str(o, 'output', path),
    pileCapacity: num(o, 'pileCapacity', path, { min: 1, int: true }),
    radius: positive(o, 'radius', path),
  };
  if (kind === 'processor') {
    const inputs = arr(o.inputs, `${path}.inputs`).map((v, i) => {
      if (typeof v !== 'string' || v.length === 0) fail(`${path}.inputs[${i}]`, 'expected an item id');
      return v;
    });
    if (inputs.length === 0) fail(`${path}.inputs`, 'needs at least one input');
    if (new Set(inputs).size !== inputs.length) fail(`${path}.inputs`, 'lists an input twice');
    return { kind, ...common, inputs, cycleSeconds: positive(o, 'cycleSeconds', path) };
  }
  return {
    kind,
    ...common,
    feed: str(o, 'feed', path),
    animals: num(o, 'animals', path, { min: 1, int: true }),
    secondsPerItem: positive(o, 'secondsPerItem', path),
    troughCapacity: num(o, 'troughCapacity', path, { min: 1, int: true }),
  };
}

function herdUpgrade(value: unknown, path: string): HerdUpgradeContent {
  const o = obj(value, path);
  return {
    costFractions: numbers(o.costFractions, `${path}.costFractions`, (v, p) => {
      if (v <= 0) fail(p, 'must be > 0');
    }),
  };
}

function buildingSpeed(value: unknown, path: string): BuildingSpeedContent {
  const o = obj(value, path);
  const b = {
    levels: num(o, 'levels', path, { min: 0, int: true }),
    cycleMultiplier: positive(o, 'cycleMultiplier', path),
    costMinutes: positive(o, 'costMinutes', path),
  };
  if (b.cycleMultiplier >= 1) fail(`${path}.cycleMultiplier`, 'must be < 1 so each level is faster');
  return b;
}

function inputSite(value: unknown, path: string): InputSiteContent {
  const o = obj(value, path);
  if ('from' in o) return { from: str(o, 'from', path) };
  return { pad: vec2(o.pad, `${path}.pad`), pile: vec2(o.pile, `${path}.pile`) };
}

function site(value: unknown, path: string): SiteContent {
  const o = obj(value, path);
  return {
    ...vec2(o, path),
    inputs: record(o.inputs, `${path}.inputs`, inputSite),
    outputPad: vec2(o.outputPad, `${path}.outputPad`),
    outputPile: vec2(o.outputPile, `${path}.outputPile`),
  };
}

function plot(value: unknown, path: string): PlotContent {
  const o = obj(value, path);
  const kind = oneOf(o, 'kind', path, PLOT_KINDS);
  if (kind === 'building') {
    const materials = record(o.materials, `${path}.materials`, (v, p) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) fail(p, 'expected a whole number >= 1');
      return v;
    });
    const b: BuildingPlotContent = {
      id: str(o, 'id', path),
      kind,
      machine: str(o, 'machine', path),
      cash: num(o, 'cash', path, { min: 0 }),
      materials,
      site: site(o.site, `${path}.site`),
      ...vec2(o, path),
    };
    return b;
  }
  if (kind === 'gate') {
    const g: GatePlotContent = { id: str(o, 'id', path), kind, zone: str(o, 'zone', path), ...vec2(o, path) };
    return g;
  }
  const ch: CharacterPlotContent = { id: str(o, 'id', path), kind, track: oneOf(o, 'track', path, TRACK_IDS), ...vec2(o, path) };
  return ch;
}

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
    solid: bool(o, 'solid', path),
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
    plots: arr(o.plots, `${path}.plots`).map((p, i) => plot(p, `${path}.plots[${i}]`)),
  };
}

/** Cross-references that the per-field checks cannot see. */
function checkReferences(c: Content): void {
  for (const [id, nt] of Object.entries(c.nodeTypes)) {
    if (!c.items[nt.item]) fail(`nodeTypes.${id}.item`, `unknown item "${nt.item}"`);
  }
  for (const [id, m] of Object.entries(c.machines)) {
    const inputs = m.kind === 'processor' ? m.inputs : [m.feed];
    for (const item of inputs) if (!c.items[item]) fail(`machines.${id}`, `unknown input item "${item}"`);
    if (!c.items[m.output]) fail(`machines.${id}.output`, `unknown item "${m.output}"`);
  }
  const buildingIds = new Set(c.zones.flatMap((z) => z.plots.filter((p) => p.kind === 'building').map((p) => p.id)));
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
    z.plots.forEach((p, pi) => {
      const path = `zones[${zi}].plots[${pi}]`;
      claimId(p.id, `${path}.id`);
      if (p.kind === 'gate') {
        const target = c.zones.find((other) => other.id === p.zone);
        if (!target) fail(`${path}.zone`, `unknown zone "${p.zone}"`);
        if (target.id === z.id) fail(`${path}.zone`, 'a gate must open a different zone from the one it stands in');
        return;
      }
      if (p.kind !== 'building') return;
      // The built machine's pads take these ids.
      for (const suffix of ['upgrade', 'output']) claimId(`${p.id}-${suffix}`, `${path}.id`);
      if (!c.machines[p.machine]) fail(`${path}.machine`, `unknown machine "${p.machine}"`);
      for (const item of Object.keys(p.materials)) {
        if (!c.items[item]) fail(`${path}.materials`, `unknown item "${item}"`);
      }
      const m = c.machines[p.machine];
      const inputs = m ? (m.kind === 'processor' ? m.inputs : [m.feed]) : [];
      for (const item of inputs) {
        const where = p.site.inputs[item];
        if (!where) fail(`${path}.site.inputs`, `missing input "${item}"`);
        if ('from' in where && !buildingIds.has(where.from)) fail(`${path}.site.inputs.${item}.from`, `unknown building plot "${where.from}"`);
        if ('pad' in where) claimId(`${p.id}-input-${item}`, `${path}.site.inputs.${item}`);
      }
      for (const item of Object.keys(p.site.inputs)) {
        if (!inputs.includes(item)) fail(`${path}.site.inputs.${item}`, 'the machine does not take this item');
      }
    });
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
    characterTracks: characterTracks(o.characterTracks, 'characterTracks'),
    machines: record(o.machines, 'machines', machine),
    buildingSpeed: buildingSpeed(o.buildingSpeed, 'buildingSpeed'),
    herdUpgrade: herdUpgrade(o.herdUpgrade, 'herdUpgrade'),
    zones: arr(o.zones, 'zones').map((z, i) => zone(z, `zones[${i}]`)),
  };
  checkReferences(content);
  return content;
}
