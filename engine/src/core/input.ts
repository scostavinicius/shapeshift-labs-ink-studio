// Input: keyboard, mouse and gamepad turned into actions, and actions turned into what K.character.update expects,
// once per fixed step. Two layers:
//   InputState   no DOM: holds what is pressed and what happened since the last step. Tests and the headless runner
//                (stage 6) drive it directly with press() / release() / stick().
//   DomInput     listens to a page (keys, pointer on the canvas, wheel, gamepads) and feeds an InputState.
// Movement comes out in world axes, relative to the camera: "up" on the stick walks away from the camera, whatever way
// it is turned.

/** What a player can do. Movement is four actions (and the stick); the rest are buttons. */
export type Action = 'up' | 'down' | 'left' | 'right' | 'run' | 'jump' | 'dash' | 'attack' | 'cast' | 'crouch';

/**
 * One step of input, in the shape K.character.update(dt, inp, t) takes: move / mz are the wish to walk along world x / z
 * (length up to 1), jump / dash / attack / cast are true on the step they were pressed, run / crouch / jumpHeld while held.
 */
export interface StepInput {
  move: number;
  mz: number;
  run: boolean;
  jump: boolean;
  jumpHeld: boolean;
  dash: boolean;
  attack: boolean;
  cast: boolean;
  crouch: boolean;
}

/** What the player asked of the camera since the last step: turns in radians, zoom as a factor (above 1 comes closer). */
export interface LookInput {
  yaw: number;
  pitch: number;
  zoom: number;
}

/** A click on the picture, where on it: u from the left edge, v from the top, both 0..1. */
export interface Click {
  u: number;
  v: number;
}

export interface Sample {
  act: StepInput;
  look: LookInput;
  clicks: Click[];
  /** the stick before it was turned into world axes: x right, y up (away from the camera), length up to 1 */
  stick: [number, number];
}

/**
 * The stick, turned by the camera's yaw into world x / z. The camera at yaw sits at +(sin yaw, cos yaw) from what it
 * looks at, so "up" (away from it) is -(sin yaw, cos yaw) and "right" is (cos yaw, -sin yaw), as in view.ts viewMatrix.
 */
export function stickToWorld(x: number, y: number, yaw: number): [number, number] {
  const s = Math.sin(yaw),
    c = Math.cos(yaw);
  return [x * c - y * s, -x * s - y * c];
}

export class InputState {
  private held = new Map<Action, number>();
  private pressed = new Set<Action>();
  private padStick: [number, number] = [0, 0];
  private look: LookInput = { yaw: 0, pitch: 0, zoom: 1 };
  private clicks: Click[] = [];

  /** A source (a key, a button) starts holding an action. Several sources may hold the same one. */
  press(a: Action): void {
    const n = this.held.get(a) || 0;
    if (n === 0) this.pressed.add(a);
    this.held.set(a, n + 1);
  }

  release(a: Action): void {
    const n = this.held.get(a) || 0;
    if (n <= 1) this.held.delete(a);
    else this.held.set(a, n - 1);
  }

  /** Let go of everything (the page lost focus: no key comes up while it is away). */
  releaseAll(): void {
    this.held.clear();
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** An analogue stick, x right, y up (away from the camera), each -1..1. Added to the keys. */
  stick(x: number, y: number): void {
    this.padStick = [x, y];
  }

  /** Turn and zoom the camera (added up until the next step). */
  turn(yaw: number, pitch: number, zoom = 1): void {
    this.look.yaw += yaw;
    this.look.pitch += pitch;
    this.look.zoom *= zoom;
  }

  click(u: number, v: number): void {
    this.clicks.push({ u, v });
  }

  /**
   * What the next step gets: held actions as they are, presses since the last step once, camera turns and clicks since
   * the last step. Clears what it hands out.
   */
  sample(yaw: number): Sample {
    const h = (a: Action) => this.held.has(a),
      p = (a: Action) => this.pressed.has(a);
    let x = (h('right') ? 1 : 0) - (h('left') ? 1 : 0) + this.padStick[0],
      y = (h('up') ? 1 : 0) - (h('down') ? 1 : 0) + this.padStick[1];
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    const [move, mz] = stickToWorld(x, y, yaw);
    const out: Sample = {
      act: {
        move,
        mz,
        run: h('run'),
        jump: p('jump'),
        jumpHeld: h('jump'),
        dash: p('dash'),
        attack: p('attack'),
        cast: p('cast'),
        crouch: h('crouch')
      },
      look: this.look,
      clicks: this.clicks,
      stick: [x, y]
    };
    this.pressed.clear();
    this.look = { yaw: 0, pitch: 0, zoom: 1 };
    this.clicks = [];
    return out;
  }
}

/** Key codes (KeyboardEvent.code: the place on the keyboard, whatever the layout) to actions. */
export type KeyMap = Record<string, Action>;

export const DEFAULT_KEYS: KeyMap = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
  KeyJ: 'attack',
  KeyK: 'dash',
  KeyL: 'cast',
  ControlLeft: 'crouch'
};

/** Gamepad buttons (the browser's "standard" layout) to actions: A jump, B dash, X attack, Y cast, LB crouch, RB / RT run. */
export const DEFAULT_PAD: Record<number, Action> = { 0: 'jump', 1: 'dash', 2: 'attack', 3: 'cast', 4: 'crouch', 5: 'run', 7: 'run' };

export interface DomInputOptions {
  keys?: KeyMap;
  pad?: Record<number, Action>;
  /** radians of camera turn per screen pixel dragged */
  dragYaw?: number;
  dragPitch?: number;
  /** radians a second at full right stick */
  padTurn?: number;
  /** a press that moves less than this many screen pixels before it is let go is a click, not a drag */
  clickSlop?: number;
}

const DEAD = 0.2;
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * The page's input, fed into an InputState: keys on the window, dragging the canvas turns the camera, a click on it is a
 * click, the wheel zooms, and gamepads are read when poll() is called (the browser has no events for sticks).
 */
export class DomInput {
  readonly state = new InputState();
  private keys: KeyMap;
  private pad: Record<number, Action>;
  private o: Required<Omit<DomInputOptions, 'keys' | 'pad'>>;
  private down = new Set<string>();
  private padHeld = new Set<Action>();
  private off: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    o: DomInputOptions = {}
  ) {
    this.keys = o.keys || DEFAULT_KEYS;
    this.pad = o.pad || DEFAULT_PAD;
    this.o = { dragYaw: o.dragYaw ?? 0.008, dragPitch: o.dragPitch ?? 0.006, padTurn: o.padTurn ?? 2.5, clickSlop: o.clickSlop ?? 5 };
    const on = <K extends keyof WindowEventMap>(t: Window, type: K, f: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(type, f as EventListener, opt);
      this.off.push(() => t.removeEventListener(type, f as EventListener, opt));
    };
    const onC = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      canvas.addEventListener(type, f as EventListener, opt);
      this.off.push(() => canvas.removeEventListener(type, f as EventListener, opt));
    };

    on(window, 'keydown', e => {
      const a = this.keys[e.code];
      if (!a) return;
      // leave the browser's own shortcuts alone (ctrl+R and the like), but not a bound modifier key itself
      if ((e.ctrlKey || e.metaKey || e.altKey) && !e.code.startsWith('Control')) return;
      e.preventDefault();
      if (e.repeat || this.down.has(e.code)) return;
      this.down.add(e.code);
      this.state.press(a);
    });
    on(window, 'keyup', e => {
      if (!this.down.delete(e.code)) return;
      this.state.release(this.keys[e.code]);
    });
    on(window, 'blur', () => {
      this.down.clear();
      this.padHeld.clear();
      this.state.releaseAll();
    });

    let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    onC('pointerdown', e => {
      if (e.button !== 0 || drag) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    onC('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < this.o.clickSlop) return;
      if (!drag.moved) canvas.style.cursor = 'grabbing';
      drag.moved = true;
      this.state.turn(-dx * this.o.dragYaw, dy * this.o.dragPitch);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    onC('pointerup', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        const r = canvas.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.state.click((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      }
      drag = null;
      canvas.style.cursor = 'grab';
    });
    onC('pointercancel', () => {
      drag = null;
      canvas.style.cursor = 'grab';
    });
    onC(
      'wheel',
      e => {
        e.preventDefault();
        this.state.turn(0, 0, Math.exp(-e.deltaY * 0.001));
      },
      { passive: false }
    );
  }

  /** Read the gamepads (call once a step, before sample()). The first connected pad counts. */
  poll(dt: number): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const g = Array.from(pads).find(p => p && p.connected);
    const now = new Set<Action>();
    if (g) {
      this.state.stick(dead(g.axes[0] || 0), -dead(g.axes[1] || 0));
      const rx = dead(g.axes[2] || 0),
        ry = dead(g.axes[3] || 0);
      if (rx || ry) this.state.turn(-rx * this.o.padTurn * dt, ry * this.o.padTurn * dt);
      g.buttons.forEach((b, i) => {
        const a = this.pad[i];
        if (a && b.pressed) now.add(a);
      });
    } else this.state.stick(0, 0);
    for (const a of now) if (!this.padHeld.has(a)) this.state.press(a);
    for (const a of this.padHeld) if (!now.has(a)) this.state.release(a);
    this.padHeld = now;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
  }
}
