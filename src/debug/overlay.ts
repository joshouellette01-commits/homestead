// ?debug only: fps and draw-call readout, plus sliders that edit content
// values live so feel can be tuned on the phone. "Copy" produces the changed
// values to paste back into content.json. Never shown in normal play.
import type { Content } from '../content';
import type { World } from '../render/scene';

interface Slider {
  label: string;
  path: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
}

function slider<K extends string>(
  label: string,
  section: string,
  obj: Record<K, number>,
  key: K,
  range: [min: number, max: number, step: number],
  after?: () => void,
): Slider {
  return {
    label,
    path: `${section}.${key}`,
    min: range[0],
    max: range[1],
    step: range[2],
    get: () => obj[key],
    set: (v) => {
      obj[key] = v;
      after?.();
    },
  };
}

function sliders(c: Content, world: World): Slider[] {
  const refresh = (): void => world.iso.refresh();
  return [
    slider('Walk speed', 'player', c.player, 'walkSpeed', [2, 8, 0.1]),
    slider('Swing (s)', 'player', c.player, 'swingSeconds', [0.3, 1.5, 0.05]),
    slider('View size', 'camera', c.camera, 'viewSize', [6, 20, 0.5], refresh),
    slider('Camera lerp (s)', 'camera', c.camera, 'followLerpSeconds', [0, 0.5, 0.01]),
    slider('Item height', 'feel', c.feel, 'stackItemHeight', [0.1, 0.4, 0.01]),
    slider('Sway stiffness', 'feel', c.feel, 'stackSwayStiffness', [5, 200, 1]),
    slider('Sway damping', 'feel', c.feel, 'stackSwayDamping', [0, 30, 0.5]),
    slider('Sway per speed', 'feel', c.feel, 'stackSwayPerSpeed', [0, 0.2, 0.005]),
    slider('Sway max', 'feel', c.feel, 'stackSwayMax', [0, 1, 0.01]),
    slider('Deadzone', 'controls', c.controls, 'deadzone', [0, 0.4, 0.01]),
    slider('Full speed at', 'controls', c.controls, 'fullSpeedAt', [0.2, 1, 0.01]),
  ];
}

const CSS = `
.dbg { position: absolute; left: calc(env(safe-area-inset-left) + 8px); bottom: calc(env(safe-area-inset-bottom) + 8px);
  z-index: 1001; font: 12px/1.3 ui-monospace, Menlo, monospace; color: #fff; }
.dbg-stats { background: rgba(0,0,0,.6); padding: 4px 8px; border-radius: 6px; display: inline-block; }
.dbg button { font: inherit; margin-left: 6px; padding: 4px 8px; border-radius: 6px; border: none; background: #f2c14e; color: #222; }
.dbg-panel { margin-top: 6px; background: rgba(0,0,0,.75); padding: 8px; border-radius: 8px; width: min(320px, calc(100vw - 32px));
  max-height: 55vh; overflow-y: auto; touch-action: pan-y; }
.dbg-row { display: grid; grid-template-columns: 1fr 52px; gap: 2px 8px; margin-bottom: 6px; }
.dbg-row input { grid-column: 1 / 3; width: 100%; }
.dbg-out { width: 100%; height: 90px; margin-top: 6px; font: inherit; }
`;

export function createDebugOverlay(root: HTMLElement, content: Content, world: World): (dt: number) => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'dbg';
  root.appendChild(box);

  const statsRow = document.createElement('div');
  const stats = document.createElement('span');
  stats.className = 'dbg-stats';
  const toggle = document.createElement('button');
  toggle.textContent = 'Tune';
  const shadowBtn = document.createElement('button');
  statsRow.append(stats, toggle, shadowBtn);
  box.appendChild(statsRow);

  const panel = document.createElement('div');
  panel.className = 'dbg-panel';
  panel.hidden = true;
  box.appendChild(panel);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  const updateShadowLabel = (): void => {
    shadowBtn.textContent = world.shadowsEnabled ? 'Shadows on' : 'Shadows off';
  };
  updateShadowLabel();
  shadowBtn.addEventListener('click', () => {
    world.shadowsOverridden = true;
    world.setShadows(!world.shadowsEnabled);
    updateShadowLabel();
  });

  const list = sliders(content, world);
  const original = new Map(list.map((s) => [s.path, s.get()]));
  for (const s of list) {
    const row = document.createElement('label');
    row.className = 'dbg-row';
    const name = document.createElement('span');
    name.textContent = s.label;
    const value = document.createElement('span');
    value.textContent = String(s.get());
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(s.get());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      s.set(v);
      value.textContent = String(v);
    });
    row.append(name, value, input);
    panel.appendChild(row);
  }

  const copy = document.createElement('button');
  copy.textContent = 'Copy changes';
  const out = document.createElement('textarea');
  out.className = 'dbg-out';
  out.readOnly = true;
  copy.addEventListener('click', () => {
    const changed: Record<string, number> = {};
    for (const s of list) if (s.get() !== original.get(s.path)) changed[s.path] = s.get();
    out.value = JSON.stringify(changed, null, 2);
    out.select();
    navigator.clipboard?.writeText(out.value).catch(() => {
      // iOS home-screen apps may refuse; the selected text is there to copy by hand.
    });
  });
  panel.append(copy, out);

  let frames = 0;
  let elapsed = 0;
  return (dt: number) => {
    frames += 1;
    elapsed += dt;
    if (elapsed >= 0.5) {
      const info = world.renderer.info.render;
      stats.textContent = `${Math.round(frames / elapsed)} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris`;
      frames = 0;
      elapsed = 0;
    }
  };
}
