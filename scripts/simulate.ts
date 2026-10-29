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

interface Targets {
  farmhouseHours: Band;
  stage1HandCashPerMinute: number;
  stage2HandCashPerMinute: number;
  yardPurchaseMinutes: Band;
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

function loadTargets(file: string): Targets {
  const raw = readJson(file);
  return {
    farmhouseHours: band(raw, 'farmhouseHours', file),
    stage1HandCashPerMinute: number(raw, 'stage1HandCashPerMinute', file),
    stage2HandCashPerMinute: number(raw, 'stage2HandCashPerMinute', file),
    yardPurchaseMinutes: band(raw, 'yardPurchaseMinutes', file),
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
const minutes = minutesArg >= 0 ? Number(process.argv[minutesArg + 1]) : 30;
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be a positive number');

const CHECKPOINTS = [1, 3, 5, 10, 30, 60, 120, 300].filter((m) => m <= minutes);
/** Income is measured over this trailing window when pricing a purchase. */
const INCOME_WINDOW_MINUTES = 3;

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
  /** Income per minute from the start until the first machine was built. */
  beforeMachine: number | null;
  /** Income per minute over the last third of the run, if a machine stood by then. */
  withMachine: number | null;
  idleShare: number;
}

/** Sell value of the materials a building plot takes. */
function materialValue(c: Content, padId: string): number {
  const plot = buildingPlots(c).find((p) => p.id === padId);
  if (!plot) return 0;
  return Object.entries(plot.materials).reduce((sum, [item, n]) => sum + n * (c.items[item]?.sellPrice ?? 0), 0);
}

function bandFor(c: Content, padId: string): Band {
  return buildingPlots(c).some((p) => p.id === padId) ? targets.yardPurchaseMinutes : targets.upgradeMinutes;
}

function run(bot: Bot, c: Content): Result {
  const s: SimState = createState(c);
  const cashAt = new Map<number, number>();
  const purchases: Purchase[] = [];
  const steps = Math.round((minutes * 60) / SIM_DT);
  // Gross earnings (sales), sampled once a second for trailing-window rates.
  const earnedAt: number[] = [0];
  let earned = 0;
  let firstMachineAt: number | null = null;
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
        if (firstMachineAt === null && s.buildings.some((b) => b.built)) firstMachineAt = t;
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
  const lastThird = total / 3;
  return {
    bot: bot.name,
    cashAt,
    purchases,
    beforeMachine: firstMachineAt !== null && firstMachineAt > 0 ? ((earnedAt[Math.floor(firstMachineAt)] ?? 0) / firstMachineAt) * 60 : null,
    withMachine: firstMachineAt !== null && firstMachineAt < total - lastThird ? rateOver(lastThird) : null,
    idleShare: idleSteps / steps,
  };
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
  'bot'.padEnd(10) +
    CHECKPOINTS.map((m) => pad(`cash@${m}m`, 10)).join('') +
    pad('buys', 6) +
    pad('pre-mill/m', 12) +
    pad('mill/m', 9) +
    pad('idle', 7) +
    pad('Farmhouse', 12),
);
for (const r of results) {
  console.log(
    r.bot.padEnd(10) +
      CHECKPOINTS.map((m) => pad(Math.floor(r.cashAt.get(m) ?? 0), 10)).join('') +
      pad(r.purchases.length, 6) +
      pad(perMin(r.beforeMachine), 12) +
      pad(perMin(r.withMachine), 9) +
      pad(`${Math.round(r.idleShare * 100)}%`, 7) +
      pad('n/a', 12),
  );
}

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
console.log(
  `Stage targets (DESIGN.md): about ${targets.stage1HandCashPerMinute} cash/min hand chopping, ` +
    `${targets.stage2HandCashPerMinute} with a hand-fed Sawmill. "mill/m" is income over the last third of the run.`,
);
console.log(`Pacing: ${outOfBand} purchase(s) outside DESIGN.md's bands (Yard buildings 1-3 min, upgrades 2-5 min).`);
console.log(
  `Farmhouse target: ${targets.farmhouseHours.min}-${targets.farmhouseHours.max} h for the priority bot; not measurable until the Market (phase 6).`,
);
