// HUD: carried/capacity top-left, cash top-right, a pause button, and the
// full-stack cap that floats over the stack. Nothing else, per DESIGN.md.
import { COLORS, ITEM_COLORS } from '../render/config';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

const formatCash = new Intl.NumberFormat('en-US');

export class Hud {
  private readonly carriedPill: HTMLElement;
  private readonly carriedTypes: HTMLElement;
  private readonly carried: HTMLElement;
  private readonly cash: HTMLElement;
  private readonly cap: HTMLElement;
  private readonly pauseOverlay: HTMLElement;
  private lastCarried = '';
  private lastCash = -1;
  private lastTypes = '';
  /** Shown while the stack is empty: the last item carried. */
  private lastItem = 'log';

  constructor(root: HTMLElement, onPause: () => void, onResume: () => void) {
    const hud = el('div', 'hud', root);

    this.carriedPill = el('div', 'hud-pill hud-carried', hud);
    this.carriedTypes = el('span', 'hud-types', this.carriedPill);
    this.carried = el('span', 'hud-value', this.carriedPill);

    const right = el('div', 'hud-right', hud);
    const cashPill = el('div', 'hud-pill hud-cash', right);
    el('span', 'hud-coin', cashPill);
    this.cash = el('span', 'hud-value', cashPill);

    const pause = el('button', 'hud-pause', right);
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('click', onPause);

    this.cap = el('div', 'hud-cap', hud);
    this.cap.textContent = 'MAX';

    this.pauseOverlay = el('div', 'overlay pause-overlay', root);
    this.pauseOverlay.hidden = true;
    const card = el('div', 'overlay-card', this.pauseOverlay);
    el('div', 'pause-icon', card);
    this.pauseOverlay.addEventListener('click', onResume);
  }

  setPaused(paused: boolean): void {
    this.pauseOverlay.hidden = !paused;
  }

  update(cash: number, stack: readonly string[], capacity: number, capScreen: { x: number; y: number } | null): void {
    const carried = stack.length;
    // One icon per item type in pickup order, each with its count once there are two or more types.
    const counts = new Map<string, number>();
    for (const item of stack) counts.set(item, (counts.get(item) ?? 0) + 1);
    const top = stack[carried - 1];
    if (top !== undefined) this.lastItem = top;
    if (counts.size === 0) counts.set(this.lastItem, 0);
    const types = [...counts].map(([item, n]) => `${item}:${n}`).join(',');
    if (types !== this.lastTypes) {
      this.carriedTypes.replaceChildren();
      for (const [item, n] of counts) {
        const type = el('span', 'hud-type', this.carriedTypes);
        el('span', 'hud-item-icon', type).style.background = hex(ITEM_COLORS[item] ?? COLORS.unknownItem);
        if (counts.size > 1) el('span', 'hud-type-count', type).textContent = String(n);
      }
      this.lastTypes = types;
    }
    const text = `${carried}/${capacity}`;
    if (text !== this.lastCarried) {
      this.carried.textContent = text;
      this.carriedPill.classList.toggle('full', carried >= capacity);
      this.lastCarried = text;
    }
    const rounded = Math.floor(cash);
    if (rounded !== this.lastCash) {
      this.cash.textContent = formatCash.format(rounded);
      this.lastCash = rounded;
    }
    if (capScreen) {
      this.cap.style.display = 'block';
      this.cap.style.transform = `translate(${capScreen.x}px, ${capScreen.y}px) translate(-50%, -100%)`;
    } else {
      this.cap.style.display = 'none';
    }
  }
}

/** A blocking dialog with one message and a set of buttons. */
export function showDialog(root: HTMLElement, message: string, buttons: Array<{ label: string; onClick: () => void }>): () => void {
  const overlay = el('div', 'overlay dialog-overlay', root);
  const card = el('div', 'overlay-card dialog', overlay);
  el('p', 'dialog-message', card).textContent = message;
  const row = el('div', 'dialog-buttons', card);
  const close = (): void => overlay.remove();
  for (const b of buttons) {
    const btn = el('button', 'dialog-button', row);
    btn.textContent = b.label;
    btn.addEventListener('click', () => {
      close();
      b.onClick();
    });
  }
  return close;
}
