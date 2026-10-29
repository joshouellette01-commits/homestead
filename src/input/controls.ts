// The only input: a floating touch joystick, plus WASD/arrows on desktop.
// Produces a world-space deflection for the sim; the sim applies the deadzone.
import { create } from 'nipplejs';
import type { SimInput } from '../sim/state';

const JOYSTICK_SIZE_PX = 110;

const KEY_DIRS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class Controls {
  /** Screen-space deflection, +y up, magnitude 0..1. */
  private stick = { x: 0, y: 0 };
  private readonly keys = new Set<string>();

  constructor(zone: HTMLElement) {
    const joystick = create({
      zone,
      mode: 'dynamic',
      size: JOYSTICK_SIZE_PX,
      color: 'white',
      fadeTime: 120,
    });
    joystick.on('move', (e) => {
      this.stick = { x: e.data.vector.x, y: e.data.vector.y };
    });
    joystick.on('end', () => {
      this.stick = { x: 0, y: 0 };
    });

    window.addEventListener('keydown', (e) => {
      if (e.code in KEY_DIRS) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
  }

  reset(): void {
    this.stick = { x: 0, y: 0 };
    this.keys.clear();
  }

  private screen(): { x: number; y: number } {
    if (this.stick.x !== 0 || this.stick.y !== 0) return this.stick;
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const d = KEY_DIRS[k];
      if (d) {
        x += d[0];
        y += d[1];
      }
    }
    const m = Math.hypot(x, y);
    return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  /** Deflection in world space for a camera rotated yawRad around the vertical axis. */
  read(yawRad: number): SimInput {
    const { x, y } = this.screen();
    // Screen right and screen up projected onto the ground plane.
    const rightX = Math.cos(yawRad);
    const rightZ = -Math.sin(yawRad);
    const upX = -Math.sin(yawRad);
    const upZ = -Math.cos(yawRad);
    return { x: rightX * x + upX * y, z: rightZ * x + upZ * y };
  }
}
