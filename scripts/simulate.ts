// Headless balance simulator: plays the game with no renderer and reports
// income and (once plots exist) time to the Farmhouse for each bot.
// Usage: npm run sim [-- --minutes 30]
import { readFileSync } from 'node:fs';
import { parseContent } from '../src/content/load';
import type { Content } from '../src/content';
import { createState } from '../src/sim/state';
import { SIM_DT, tick } from '../src/sim/tick';
import { GreedyBot, PriorityBot, type Bot } from './sim/bots';

interface Targets {
  farmhouseHours: { min: number; max: number };
  stage1HandCashPerMinute: number;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const content = parseContent(readJson('src/content/content.json'));
const targets = readJson('scripts/sim/targets.json') as Targets;
const priorityOrder = (readJson('scripts/sim/priority-order.json') as { order: string[] }).order;

const minutesArg = process.argv.indexOf('--minutes');
const minutes = minutesArg >= 0 ? Number(process.argv[minutesArg + 1]) : 30;
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be a positive number');

const CHECKPOINTS = [1, 3, 5, 10, 30, 60, 120, 300].filter((m) => m <= minutes);
/** Minutes skipped before measuring steady income, so walking out from spawn doesn't count. */
const WARMUP_MINUTES = Math.min(1, minutes / 2);

interface Result {
  bot: string;
  cashAt: Map<number, number>;
  steadyPerMinute: number;
  idleShare: number;
}

function run(bot: Bot, c: Content): Result {
  const s = createState(c);
  const cashAt = new Map<number, number>();
  const steps = Math.round((minutes * 60) / SIM_DT);
  let warmCash = 0;
  let idleSteps = 0;
  let next = 0;
  for (let i = 1; i <= steps; i++) {
    const input = bot.decide(s, c);
    const events = tick(s, input, c, SIM_DT);
    // Idle: not moving, not harvesting, and nothing happened.
    const moving = s.player.vx !== 0 || s.player.vz !== 0;
    if (!moving && s.player.harvesting < 0 && events.length === 0 && s.player.transferTimer === 0) idleSteps++;
    const t = i * SIM_DT;
    if (Math.abs(t - WARMUP_MINUTES * 60) < SIM_DT / 2) warmCash = s.cash;
    const checkpoint = CHECKPOINTS[next];
    if (checkpoint !== undefined && t >= checkpoint * 60 - SIM_DT / 2) {
      cashAt.set(checkpoint, s.cash);
      next++;
    }
  }
  return {
    bot: bot.name,
    cashAt,
    steadyPerMinute: (s.cash - warmCash) / (minutes - WARMUP_MINUTES),
    idleShare: idleSteps / steps,
  };
}

const started = performance.now();
const results = [run(new GreedyBot(), content), run(new PriorityBot(priorityOrder), content)];
const elapsed = (performance.now() - started) / 1000;

const pad = (v: string | number, n: number): string => String(v).padStart(n);
console.log(`Homestead balance simulator: content v${content.contentVersion}, ${minutes} min of play per bot (${elapsed.toFixed(1)} s)`);
console.log('');
console.log(
  'bot'.padEnd(10) + CHECKPOINTS.map((m) => pad(`cash@${m}m`, 10)).join('') + pad('cash/min', 10) + pad('idle', 7) + pad('Farmhouse', 12),
);
for (const r of results) {
  console.log(
    r.bot.padEnd(10) +
      CHECKPOINTS.map((m) => pad(Math.floor(r.cashAt.get(m) ?? 0), 10)).join('') +
      pad(r.steadyPerMinute.toFixed(1), 10) +
      pad(`${Math.round(r.idleShare * 100)}%`, 7) +
      pad('n/a', 12),
  );
}
console.log('');
console.log(`Stage 1 target (DESIGN.md): about ${targets.stage1HandCashPerMinute} cash/min from hand chopping.`);
console.log(
  `Farmhouse target: ${targets.farmhouseHours.min}-${targets.farmhouseHours.max} h for the priority bot; not measurable until plots exist (phase 3).`,
);
