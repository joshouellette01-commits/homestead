// Dashed plots: a dashed ring on the ground, an inner ring that fills while a
// purchase is in progress, and a price label floating above in world space.
// Covers building plots, the speed plots that replace them, and the
// Workbench's character plots.
import {
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Content, TrackId } from '../content';
import { activePads, buildingPlots, materialsDone, plotPrice, upgradeLevels, type ActivePad } from '../sim/plots';
import type { SimState } from '../sim/state';
import { COLORS, ITEM_COLORS, PLOTS } from './config';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

// Small inline icons for the plot labels: what each plot upgrades.
const ICONS: Record<TrackId | 'speed' | 'herd' | 'gate', string> = {
  capacity:
    '<svg viewBox="0 0 20 20"><rect x="3" y="13" width="14" height="4" rx="1"/><rect x="3" y="8" width="14" height="4" rx="1"/><rect x="3" y="3" width="14" height="4" rx="1"/></svg>',
  walkSpeed: '<svg viewBox="0 0 20 20"><path d="M3 4l6 6-6 6V4zm8 0l6 6-6 6V4z"/></svg>',
  swingSeconds:
    '<svg viewBox="0 0 20 20"><rect x="9" y="5" width="2.4" height="13" rx="1"/><path d="M5 3h9a3 3 0 0 1 0 6H5c1-1 1-5 0-6z"/></svg>',
  herd: '<svg viewBox="0 0 20 20"><path d="M10 3.5a3 3 0 0 1 3 3v1.2l2.3 1.1-2.3.9V11a4.5 4.5 0 1 1-6-4.2V6.5a3 3 0 0 1 3-3z"/></svg>',
  gate: '<svg viewBox="0 0 20 20"><rect x="2" y="4" width="2.4" height="13"/><rect x="15.6" y="4" width="2.4" height="13"/><rect x="4" y="7" width="12" height="2.2"/><rect x="4" y="12" width="12" height="2.2"/><path d="M4 9.2l12 2.8v2.2L4 11.4z"/></svg>',
  speed:
    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 5v5.5l3.5 2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

function dashedRing(inner: number, outer: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const step = (Math.PI * 2) / PLOTS.dashes;
  for (let i = 0; i < PLOTS.dashes; i++) {
    parts.push(new RingGeometry(inner, outer, 3, 1, i * step, step * PLOTS.dashFill));
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('could not build the dashed ring');
  return merged;
}

interface PlotView {
  id: string;
  x: number;
  z: number;
  dashes: Mesh;
  fill: Mesh<RingGeometry>;
  label: HTMLElement;
  lastLabel: string;
}

export class PlotsView {
  private readonly views: PlotView[] = [];
  private readonly projected = new Vector3();

  constructor(
    scene: Scene,
    private readonly labelRoot: HTMLElement,
    private readonly content: Content,
  ) {
    const r = content.interaction.padRadius;
    const dashGeo = dashedRing(r * PLOTS.dashInner, r);
    const dashMat = new MeshBasicMaterial({ color: COLORS.plotDash, transparent: true, opacity: 0.9 });
    const fillMat = new MeshBasicMaterial({ color: COLORS.padActive });
    const add = (id: string, x: number, z: number): void => {
      const dashes = new Mesh(dashGeo, dashMat);
      dashes.rotation.x = -Math.PI / 2;
      dashes.position.set(x, 0.015, z);
      // Starts at the top of the screen (local 135 degrees after laying the ring flat).
      const fill = new Mesh(
        new RingGeometry(r * PLOTS.fillInner, r * PLOTS.fillOuter, PLOTS.fillSegments, 1, (Math.PI * 3) / 4, Math.PI * 2),
        fillMat,
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(x, 0.02, z);
      fill.geometry.setDrawRange(0, 0);
      scene.add(dashes, fill);
      const label = document.createElement('div');
      label.className = 'plot-label';
      labelRoot.appendChild(label);
      this.views.push({ id, x, z, dashes, fill, label, lastLabel: '' });
    };
    for (const zone of content.zones) {
      for (const p of zone.plots) {
        add(p.id, p.x, p.z);
        // Same spot: the upgrade plot shows once the building stands.
        if (p.kind === 'building') add(`${p.id}-upgrade`, p.x, p.z);
      }
    }
  }

  update(s: SimState, camera: Camera): void {
    const pads = new Map<string, ActivePad>();
    for (const pad of activePads(s, this.content)) pads.set(pad.id, pad);
    const width = this.labelRoot.clientWidth;
    const height = this.labelRoot.clientHeight;

    for (const v of this.views) {
      const pad = pads.get(v.id);
      const shown = pad !== undefined || this.isMaxed(s, v.id);
      v.dashes.visible = shown;
      v.fill.visible = shown;
      if (!shown) {
        v.label.style.display = 'none';
        continue;
      }
      const ring = s.purchase.pad === v.id ? s.purchase.progress / this.content.interaction.purchaseSeconds : 0;
      const segments = Math.round(Math.min(1, ring) * PLOTS.fillSegments);
      v.fill.geometry.setDrawRange(0, segments * 6);
      v.fill.visible = segments > 0;

      const html = pad ? this.labelHtml(s, pad) : '<span class="plot-max">MAX</span>';
      if (html !== v.lastLabel) {
        v.label.innerHTML = html;
        v.lastLabel = html;
      }
      this.projected.set(v.x, PLOTS.labelHeight, v.z).project(camera);
      const sx = ((this.projected.x + 1) / 2) * width;
      const sy = ((1 - this.projected.y) / 2) * height;
      const m = PLOTS.labelMarginPx;
      const onScreen = sx > -m && sx < width + m && sy > -m && sy < height + m;
      v.label.style.display = onScreen ? 'flex' : 'none';
      if (onScreen) v.label.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
  }

  /** A character or building upgrade plot whose last level is bought: it stays, labelled MAX. */
  private isMaxed(s: SimState, id: string): boolean {
    for (const zone of this.content.zones) {
      for (const p of zone.plots) {
        if (p.kind === 'character' && p.id === id) return s.levels[p.track] >= this.content.characterTracks[p.track].values.length - 1;
      }
    }
    const plots = buildingPlots(this.content);
    const index = plots.findIndex((p) => `${p.id}-upgrade` === id);
    const b = s.buildings[index];
    const machine = this.content.machines[plots[index]?.machine ?? ''];
    return b !== undefined && machine !== undefined && b.built && b.level >= upgradeLevels(this.content, machine);
  }

  private labelHtml(s: SimState, pad: ActivePad): string {
    const price = plotPrice(s, this.content, pad);
    if (!price) return '';
    const parts: string[] = [];
    if (pad.kind === 'character') parts.push(`<span class="plot-icon">${ICONS[pad.track]}</span>`);
    if (pad.kind === 'upgrade') {
      const machine = this.content.machines[buildingPlots(this.content)[pad.building]?.machine ?? ''];
      parts.push(`<span class="plot-icon">${machine?.kind === 'animals' ? ICONS.herd : ICONS.speed}</span>`);
    }
    if (pad.kind === 'gate') parts.push(`<span class="plot-icon">${ICONS.gate}</span>`);
    for (const m of price.materials) {
      if (m.have >= m.need) continue;
      const color = hex(ITEM_COLORS[m.item] ?? COLORS.unknownItem);
      parts.push(`<span class="plot-row"><span class="plot-item" style="background:${color}"></span>${m.have}/${m.need}</span>`);
    }
    // Price greys out until the player can actually start the ring.
    const locked = s.purchase.locked && s.purchase.pad === pad.id;
    const ready = !locked && materialsDone(price) && s.cash >= price.cash;
    parts.push(`<span class="plot-row plot-price${ready ? '' : ' cant'}"><span class="plot-coin"></span>${price.cash}</span>`);
    return parts.join('');
  }
}
