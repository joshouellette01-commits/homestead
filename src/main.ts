import { Vector3 } from 'three';
import { content } from './content';
import { Controls } from './input/controls';
import { RENDER } from './render/config';
import { World } from './render/scene';
import { applySave, clearSave, getStorage, readSave, toSave, writeSave } from './save/save';
import { createState, type SimState } from './sim/state';
import { SIM_DT, tick } from './sim/tick';
import { Hud, showDialog } from './ui/hud';

const AUTOSAVE_SECONDS = 10;

const app = document.getElementById('app');
if (!app) throw new Error('#app missing from index.html');
const root: HTMLElement = app;

const storage = getStorage();

function start(state: SimState): void {
  const world = new World(root, content, state);
  const touch = document.createElement('div');
  touch.id = 'touch';
  root.appendChild(touch);
  const controls = new Controls(touch);

  let paused = false;
  const save = (): void => {
    writeSave(storage, toSave(state));
  };
  const hud = new Hud(
    root,
    () => {
      paused = true;
      controls.reset();
      hud.setPaused(true);
      save();
    },
    () => {
      paused = false;
      hud.setPaused(false);
    },
  );

  function resize(): void {
    world.resize(root.clientWidth, root.clientHeight);
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      controls.reset();
      save();
    }
  });
  window.addEventListener('pagehide', save);

  // Shadows drop for good if the first seconds of play run slow.
  const probe = { frames: 0, seconds: 0, done: false };

  const capWorld = new Vector3();
  let accumulator = 0;
  let sinceSave = 0;
  let last = performance.now();
  const frame = { prevX: state.player.x, prevZ: state.player.z, alpha: 1 };

  world.renderer.setAnimationLoop((now: number) => {
    const dt = Math.min((now - last) / 1000, RENDER.maxFrameSeconds);
    last = now;

    if (!paused) {
      accumulator += dt;
      while (accumulator >= SIM_DT) {
        frame.prevX = state.player.x;
        frame.prevZ = state.player.z;
        const events = tick(state, controls.read(world.iso.yawRad), content, SIM_DT);
        world.handleEvents(events);
        accumulator -= SIM_DT;
      }
      frame.alpha = accumulator / SIM_DT;

      sinceSave += dt;
      if (sinceSave >= AUTOSAVE_SECONDS) {
        sinceSave = 0;
        save();
      }

      if (!probe.done) {
        probe.frames += 1;
        probe.seconds += dt;
        if (probe.seconds >= RENDER.shadowProbeSeconds) {
          probe.done = true;
          if (probe.frames / probe.seconds < RENDER.shadowMinFps) world.setShadows(false);
        }
      }
    }

    world.update(state, frame, paused ? 0 : dt);
    world.render();

    const full = state.player.stack.length >= content.player.capacity;
    let cap: { x: number; y: number } | null = null;
    if (full) {
      world.farmer.stackTopWorld(capWorld).project(world.iso.camera);
      cap = { x: ((capWorld.x + 1) / 2) * root.clientWidth, y: ((1 - capWorld.y) / 2) * root.clientHeight };
    }
    hud.update(state.cash, state.player.stack.length, content.player.capacity, cap);
  });
}

const state = createState(content);
const loaded = readSave(storage);
if (loaded.kind === 'corrupt') {
  console.error('Save failed to load:', loaded.error);
  showDialog(root, "Your saved farm couldn't be loaded. Start a new farm? This erases the old save.", [
    {
      label: 'Start over',
      onClick: () => {
        clearSave(storage);
        start(state);
      },
    },
  ]);
} else {
  if (loaded.kind === 'ok') applySave(state, loaded.data, content);
  start(state);
}
