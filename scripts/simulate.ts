// Headless balance simulator: plays the game with no renderer and reports
// income, each purchase against DESIGN.md's pacing rule, and (once it exists)
// time to the Farmhouse for each bot.
// Usage: npm run sim [-- --minutes 30]
import { readFileSync } from 'node:fs';
import { parseContent } from '../src/content/load';
import type { Content } from '../src/content';
import { buildingPlots } from '../src/sim/plots';
import { createState, type SimState } from '../src/sim/state';
import { SIM_DT, isPlayerEvent, tick } from '../src/sim/tick';
import { GreedyBot, PriorityBot, type Bot } from './sim/bots';

interface Band {
  min: number;
  max: number;
}

interface Stage {
  name: string;
  /** Starts when this plot is bought (or at the start). */
  from: string | null;
  /** Ends when this plot is bought (or at the end). */
  until: string | null;
  cashPerMinute: number;
}

interface Targets {
  farmhouseHours: Band;
  stages: Stage[];
  yardPurchaseMinutes: Band;
  majorPurchaseMinutes: Band;
  upgradeMinutes: Band;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function field(obj: unknown, key: string, file: string): unknown {
  if (typeof obj !== 'object' || obj === null || !(key in obj)) throw new Error(`${file}: missing "${key}"`);
  return (obj as Record<string, unknown>)[key];
}

function number(obj: unknown, key: string, file: string): number {
  const v = field(obj, key, file);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${file}: "${key}" must be a number`);
  return v;
}

function band(obj: unknown, key: string, file: string): Band {
  const b = field(obj, key, file);
  return { min: number(b, 'min', file), max: number(b, 'max', file) };
}

function optionalId(obj: unknown, key: string, file: string): string | null {
  if (typeof obj !== 'object' || obj === null || !(key in obj)) return null;
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'string') throw new Error(`${file}: "${key}" must be a plot id`);
  return v;
}

function loadTargets(file: string): Targets {
  const raw = readJson(file);
  const stages = field(raw, 'stages', file);
  if (!Array.isArray(stages)) throw new Error(`${file}: "stages" must be a list`);
  return {
    farmhouseHours: band(raw, 'farmhouseHours', file),
    stages: stages.map((st) => ({
      name: String(field(st, 'name', file)),
      from: optionalId(st, 'from', file),
      until: optionalId(st, 'until', file),
      cashPerMinute: number(st, 'cashPerMinute', file),
    })),
    yardPurchaseMinutes: band(raw, 'yardPurchaseMinutes', file),
    majorPurchaseMinutes: band(raw, 'majorPurchaseMinutes', file),
    upgradeMinutes: band(raw, 'upgradeMinutes', file),
  };
}

function loadOrder(file: string): string[] {
  const order = field(readJson(file), 'order', file);
  if (!Array.isArray(order) || !order.every((o) => typeof o === 'string')) {
    throw new Error(`${file}: "order" must be a list of plot ids`);
  }
  return order;
}

const content = parseContent(readJson('src/content/content.json'));
const targets = loadTargets('scripts/sim/targets.json');
const priorityOrder = loadOrder('scripts/sim/priority-order.json');

const minutesArg = process.argv.indexOf('--minutes');
const minutes = minutesArg >= 0 ? Number(process.argv[minutesArg + 1]) : 120;
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be a positive number');

const CHECKPOINTS = [1, 3, 5, 10, 30, 60, 120, 300].filter((m) => m <= minutes);
/** Income is measured over this trailing window when pricing a purchase. */
const INCOME_WINDOW_MINUTES = 5;

interface Purchase {
  time: number;
  pad: string;
  /** Cash plus the sell value of the materials carried in. */
  cost: number;
  /** cost divided by the income rate over the trailing window. */
  minutesOfIncome: number;
  band: Band;
}

interface Result {
  bot: string;
  cashAt: Map<number, number>;
  purchases: Purchase[];
  /** Income per minute over each stage in targets.json, or null if the run never reached it. */
  stageIncome: Array<number | null>;
  idleShare: number;
}

/** Sell value of the materials a building plot takes. */
function materialValue(c: Content, padId: string): number {
  const plot = buildingPlots(c).find((p) => p.id === padId);
  if (!plot) return 0;
  return Object.entries(plot.materials).reduce((sum, [item, n]) => sum + n * (c.items[item]?.sellPrice ?? 0), 0);
}

/** DESIGN.md's pacing rule: Yard buildings 1-3 minutes, gates and other buildings 8-15, upgrades 2-5. */
function bandFor(c: Content, padId: string): Band {
  for (const zone of c.zones) {
    for (const p of zone.plots) {
      if (p.id !== padId) continue;
      if (p.kind === 'gate') return targets.majorPurchaseMinutes;
      if (p.kind === 'building') return zone.gateCost === 0 ? targets.yardPurchaseMinutes : targets.majorPurchaseMinutes;
    }
  }
  return targets.upgradeMinutes;
}

function run(bot: Bot, c: Content): Result {
  const s: SimState = createState(c);
  const cashAt = new Map<number, number>();
  const purchases: Purchase[] = [];
  const steps = Math.round((minutes * 60) / SIM_DT);
  // Gross earnings (sales), sampled once a second for trailing-window rates.
  const earnedAt: number[] = [0];
  let earned = 0;
  /** When each plot pad was first bought, in seconds. */
  const boughtAt = new Map<string, number>();
  let idleSteps = 0;
  let next = 0;

  const rateOver = (seconds: number): number => {
    const now = earnedAt.length - 1;
    const back = Math.min(now, Math.round(seconds));
    return back === 0 ? 0 : ((earned - (earnedAt[now - back] ?? 0)) / back) * 60;
  };

  for (let i = 1; i <= steps; i++) {
    const input = bot.decide(s, c);
    const events = tick(s, input, c, SIM_DT);
    const t = i * SIM_DT;
    for (const e of events) {
      if (e.type === 'sell') earned += e.price;
      if (e.type === 'purchase') {
        const cost = e.cash + materialValue(c, e.pad);
        const rate = rateOver(INCOME_WINDOW_MINUTES * 60);
        purchases.push({ time: t, pad: e.pad, cost, minutesOfIncome: rate > 0 ? cost / rate : Infinity, band: bandFor(c, e.pad) });
        if (!boughtAt.has(e.pad)) boughtAt.set(e.pad, t);
      }
    }
    // Idle: not moving, not harvesting, and the player did nothing this step.
    const moving = s.player.vx !== 0 || s.player.vz !== 0;
    if (!moving && s.player.harvesting < 0 && !events.some(isPlayerEvent) && s.player.transferTimer === 0) idleSteps++;
    if (Math.abs(t - earnedAt.length) < SIM_DT / 2) earnedAt.push(earned);
    const checkpoint = CHECKPOINTS[next];
    if (checkpoint !== undefined && t >= checkpoint * 60 - SIM_DT / 2) {
      cashAt.set(checkpoint, s.cash);
      next++;
    }
  }

  const total = minutes * 60;
  const earnedBy = (t: number): number => earnedAt[Math.min(earnedAt.length - 1, Math.floor(t))] ?? 0;
  const stageIncome = targets.stages.map((st) => {
    const start = st.from === null ? 0 : boughtAt.get(st.from);
    if (start === undefined) return null;
    const end = st.until === null ? total : (boughtAt.get(st.until) ?? total);
    // Too short to measure (under a minute) reads as not reached.
    if (end - start < 60) return null;
    return ((earnedBy(end) - earnedBy(start)) / (end - start)) * 60;
  });
  return { bot: bot.name, cashAt, purchases, stageIncome, idleShare: idleSteps / steps };
}

const started = performance.now();
const results = [run(new GreedyBot(), content), run(new PriorityBot(priorityOrder), content)];
const elapsed = (performance.now() - started) / 1000;

const pad = (v: string | number, n: number): string => String(v).padStart(n);
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const perMin = (v: number | null): string => (v === null ? 'n/a' : v.toFixed(1));

console.log(`Homestead balance simulator: content v${content.contentVersion}, ${minutes} min of play per bot (${elapsed.toFixed(1)} s)`);
console.log('');
console.log(
  'bot'.padEnd(10) + CHECKPOINTS.map((m) => pad(`cash@${m}m`, 10)).join('') + pad('buys', 6) + pad('idle', 7) + pad('Farmhouse', 12),
);
for (const r of results) {
  console.log(
    r.bot.padEnd(10) +
      CHECKPOINTS.map((m) => pad(Math.floor(r.cashAt.get(m) ?? 0), 10)).join('') +
      pad(r.purchases.length, 6) +
      pad(`${Math.round(r.idleShare * 100)}%`, 7) +
      pad('n/a', 12),
  );
}
console.log('');
console.log('Income per minute by stage (DESIGN.md target in brackets):');
targets.stages.forEach((st, k) => {
  const cells = results.map((r) => `${r.bot} ${perMin(r.stageIncome[k] ?? null)}`).join('   ');
  console.log(`  ${st.name.padEnd(22)} [${st.cashPerMinute}]   ${cells}`);
});

let outOfBand = 0;
for (const r of results) {
  console.log('');
  console.log(`${r.bot}: purchases (cost = cash + material value; minutes = cost / income over the last ${INCOME_WINDOW_MINUTES} min)`);
  for (const p of r.purchases) {
    const ok = p.minutesOfIncome >= p.band.min && p.minutesOfIncome <= p.band.max;
    if (!ok) outOfBand++;
    console.log(
      `  ${pad(clock(p.time), 6)}  ${p.pad.padEnd(22)}${pad(p.cost, 7)}${pad(p.minutesOfIncome.toFixed(1), 7)} min  ` +
        `(target ${p.band.min}-${p.band.max})${ok ? '' : '  << outside'}`,
    );
  }
  if (r.purchases.length === 0) console.log('  none');
}

console.log('');
console.log(`Pacing: ${outOfBand} purchase(s) outside DESIGN.md's bands (Yard buildings 1-3 min, gates and other buildings 8-15, upgrades 2-5).`);
console.log(
  `Farmhouse target: ${targets.farmhouseHours.min}-${targets.farmhouseHours.max} h for the priority bot; not measurable until the Market (phase 6).`,
);
