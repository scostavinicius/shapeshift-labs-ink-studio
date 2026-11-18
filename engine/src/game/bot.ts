// Bots: a player made of code, for making scripts (stage 10). A bot is a function called before every step with the game
// as it is and an InputState to press; `record` keeps what it pressed as a script (an InputRecorder), and the script
// plays the same game again for ever, with no bot. The bot runs outside the step, like the HUD: it reads the game and
// presses keys, exactly what a person does, so nothing it does can break determinism.
import type { Vec3 } from '../../types/ink-studio';
import type { Action, InputState } from '../core/input';
import type { RunningGame } from './game';

export interface BotApi {
  game: RunningGame<any>;
  input: InputState;
  /** walk (or run) toward a point of the world, stopping within `near` */
  walkTo(p: Vec3 | number[], near?: number, run?: boolean): void;
  /** walk (or run) straight away from a point */
  walkAway(p: Vec3 | number[], run?: boolean): void;
  /** stop walking */
  stand(): void;
  /** press a button for one step (a tap) */
  tap(a: Action): void;
  /** stop walking and let go of everything */
  stop(): void;
}

export type Bot = (api: BotApi) => void;

/**
 * Make the BotApi for a game: world directions turn into the stick as the camera sees them (the formula of AGENTS.md),
 * as one of 64 directions so a recorded script stays small; held keys are pressed and let go as the bot changes its mind.
 */
export function botApi(game: RunningGame<any>, input: InputState): { api: BotApi; before(): void } {
  let stick: [number, number] = [0, 0],
    run = false,
    taps: Action[] = [];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const toStick = (wx: number, wz: number): [number, number] => {
    const l = Math.hypot(wx, wz);
    if (l < 1e-9) return [0, 0];
    wx /= l;
    wz /= l;
    const yaw = game.core.camera.yaw,
      c = Math.cos(yaw),
      s = Math.sin(yaw),
      x = wx * c - wz * s,
      y = -wx * s - wz * c;
    // one of 64 directions: a script changes the stick only when the way really changes
    const a = (Math.round((Math.atan2(y, x) * 32) / Math.PI) * Math.PI) / 32;
    return [r3(Math.cos(a)), r3(Math.sin(a))];
  };
  const api: BotApi = {
    game,
    input,
    walkTo(p, near = 0, fast = false) {
      const me = game.player;
      if (!me) return;
      const dx = p[0] - me.pos[0],
        dz = p[2] - me.pos[2];
      if (Math.hypot(dx, dz) <= near) return api.stand();
      stick = toStick(dx, dz);
      run = fast;
    },
    walkAway(p, fast = false) {
      const me = game.player;
      if (!me) return;
      stick = toStick(me.pos[0] - p[0], me.pos[2] - p[2]);
      run = fast;
    },
    stand() {
      stick = [0, 0];
      run = false;
    },
    tap(a) {
      taps.push(a);
    },
    stop() {
      api.stand();
      taps = [];
    }
  };
  let lastStick: [number, number] = [0, 0],
    lastRun = false,
    released: Action[] = [];
  return {
    api,
    /** put this step's decisions into the input (call after the bot, before the step) */
    before() {
      for (const a of released) input.release(a);
      released = [];
      if (stick[0] !== lastStick[0] || stick[1] !== lastStick[1]) input.stick(stick[0], stick[1]);
      lastStick = stick;
      if (run !== lastRun) run ? input.press('run') : input.release('run');
      lastRun = run;
      for (const a of new Set(taps)) {
        if (input.isHeld(a)) continue;
        input.press(a);
        released.push(a);
      }
      taps = [];
    }
  };
}
