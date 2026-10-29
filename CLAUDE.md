# Homestead

A 3D low-poly gather-and-haul farm game (three.js + TypeScript + Vite, PWA on GitHub Pages, played on an iPhone home screen).

**The spec is [DESIGN.md](DESIGN.md). Read it before starting any work.** It is the source of truth for every feature, number and rule.

## Rules

- **All game numbers live in `content.json`, never in code.** Prices, costs, timings, speeds, capacities, positions, radii: if a designer might tune it, it goes in `content.json`. Balance changes must never touch code.
- **TypeScript strict.** No `any` escapes, no disabling strict checks to make an error go away.
- **Test on the phone every phase.** Each phase ends with a build installed to the iPhone home screen and played there, not just in a desktop browser.
- **Never add a feature that is not in `DESIGN.md` without asking first.** This includes "small" extras. Ideas that come up mid-build go in `BACKLOG.md`; nothing from it ships in v1.

## Workflow

- **Plan first, per phase.** Before building a phase (or a smaller feature inside one), write an implementation plan and wait for approval. Do not write code until the plan is approved.
- **Headless balance simulator.** Built in phase 2 and kept working from then on. It runs the game with no renderer and prints time-to-Farmhouse for two bots: a greedy bot (buy the cheapest affordable plot, otherwise haul the highest-value good) and a priority-order bot following a hand-written build order. The 4 to 6 hour band applies to the priority bot; the greedy bot must still finish. From phase 5 it also runs a stubbed raid model and reports undefended losses, defense payback and late-game idle share. **Every change to `content.json` reruns it.**
- **Subagent review at the end of each phase.** Spawn a second agent that reads the phase's diff against `DESIGN.md` and lists where the build drifted from the spec. Fix or explicitly accept each item before tagging.
- **Commit after every working feature**, and tag each finished phase (`phase-1`, `phase-2`, ...), so a bad day's work is one `git revert` away.
- **`BACKLOG.md`** holds ideas that come up mid-build. Nothing in it ships in v1.
