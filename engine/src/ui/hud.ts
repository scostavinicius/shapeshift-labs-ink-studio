// The HUD (stage 8): health, the ability bar and messages, drawn in DOM over the canvas in the engine's own pixel font, at
// the size of an art pixel and in the scene's palette. Two halves:
//   HudFeed / hudModel   what to show, from the game between steps (its state and the events it emitted): no DOM, so a
//                        test can check that the HUD follows the game
//   Hud                  draws a model in the page, redrawing a piece only when what it shows has changed
// The HUD never touches the game: it reads it after the steps of a frame, outside the game's dice.
import type { RunningGame } from '../game/game';
import type { Actor, GameEvent } from '../game/types';
import { GLYPH_H, HEART, rasterize } from './font';

export interface Ability {
  /** the key that does it, as shown */
  key: string;
  label: string;
  /** 0 (just used) .. 1 (ready) */
  ready: number;
}

export interface HudModel {
  hp: number;
  maxHp: number;
  /** the player is down (between dying and coming back) */
  down: boolean;
  abilities: Ability[];
  /** the game's own lines (def.hud.lines): a score, what is left to do */
  lines: string[];
  /** recent messages, newest last, with how old they are (seconds of page time) */
  messages: { text: string; age: number }[];
}

/** what a message stays on screen for, in seconds */
export const MESSAGE_LIFE = 2.5;

/** The default words for the engine's events; a game says its own with def.hud.message. */
export function defaultMessage(e: GameEvent, game: RunningGame<any>): string | null {
  const d = (e.data || {}) as Record<string, any>;
  const player = game.player;
  if (e.name === 'death') {
    if (d.team === 'player') return 'YOU FELL';
    if (player && d.by === player.id) return `${String(d.kind).toUpperCase()} DOWN`;
    return null;
  }
  if (e.name === 'respawn' && player && d.id === player.id) return 'BACK ON YOUR FEET';
  // a story's words (def.story's game/say)
  if (e.name === 'say') return String(d.text ?? '');
  return null;
}

/** The HUD's memory between frames: the messages being shown. */
export class HudFeed {
  private shown: { text: string; born: number }[] = [];

  /** take the game's events since the last frame (game.takeEvents()); `now` is page time in seconds */
  feed(events: GameEvent[], game: RunningGame<any>, now: number): void {
    const say = game.def.hud?.message;
    for (const e of events) {
      const custom = say ? say(e, game) : undefined;
      const text = custom === undefined ? defaultMessage(e, game) : custom;
      if (text) this.say(text, now);
    }
  }

  /** show a message that is not the game's (the page saying it saved) */
  say(text: string, now: number): void {
    this.shown.push({ text, born: now });
    if (this.shown.length > 4) this.shown.shift();
  }

  messages(now: number): { text: string; age: number }[] {
    this.shown = this.shown.filter(m => now - m.born < MESSAGE_LIFE);
    return this.shown.map(m => ({ text: m.text, age: now - m.born }));
  }
}

/** The game's lines: its own (def.hud.lines), or else the campaign's stages (def.story). */
export function gameLines(game: RunningGame<any>): string[] {
  if (game.def.hud?.lines) return game.def.hud.lines(game);
  return game.story ? game.story.lines() : [];
}

/** The HUD for the game as it is now. */
export function hudModel(game: RunningGame<any>, feed: HudFeed, now: number): HudModel {
  const p = game.player as Actor | null;
  const def = p && game.def.actors && game.def.actors[p.actor];
  const st = p ? p.ch.st : null;
  const abilities: Ability[] = [];
  if (st) {
    abilities.push({ key: 'J', label: 'HIT', ready: st.atk >= 0 ? 0 : 1 });
    abilities.push({ key: 'K', label: 'DASH', ready: st.dash > 0 ? 0 : Math.max(0, Math.min(1, st.dashAge / 0.45)) });
    if (p!.ch.spec && p!.ch.spec.cast) abilities.push({ key: 'L', label: 'CAST', ready: st.cast >= 0 || st.bolt ? 0 : 1 });
  }
  return {
    hp: p ? Math.max(0, p.hp) : 0,
    maxHp: (def && def.hp) || (p && p.ch.spec && (p.ch.spec.hp as number)) || 3,
    down: !!p && p.deadFor >= 0,
    abilities,
    lines: gameLines(game),
    messages: feed.messages(now)
  };
}

// ---------------------------------------------------------------------------------------------------------- drawing

/** HUD colours picked from the scene's palette (0xRRGGBB): the lightest, the darkest, the reddest, and a quiet grey */
export function hudColours(pal: number[]): { light: string; dark: string; accent: string; dim: string } {
  const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const lum = (c: number) => {
    const [r, g, b] = rgb(c);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
  const by = (f: (c: number) => number) => pal.reduce((a, b) => (f(b) > f(a) ? b : a), pal[0]);
  const light = by(lum),
    dark = by(c => -lum(c)),
    accent = by(c => {
      const [r, g, b] = rgb(c);
      return lum(c) > 0.2 ? r - Math.max(g, b) : -999;
    }),
    // a quiet grey: a middle brightness, and as little colour as the palette has
    dim = by(c => {
      const [r, g, b] = rgb(c);
      return -Math.abs(lum(c) - 0.3) - (0.5 * (Math.max(r, g, b) - Math.min(r, g, b))) / 255;
    });
  return { light: css(light), dark: css(dark), accent: css(accent), dim: css(dim) };
}

type Colours = ReturnType<typeof hudColours>;

/** a canvas showing pixel art at an integer scale, redrawn only when its key changes */
class Piece {
  readonly el: HTMLCanvasElement;
  private key = '';
  constructor(parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}) {
    this.el = document.createElement('canvas');
    Object.assign(this.el.style, { imageRendering: 'pixelated', display: 'block' }, style);
    parent.appendChild(this.el);
  }
  draw(key: string, scale: number, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): void {
    const k = key + '@' + scale;
    if (k === this.key) return;
    this.key = k;
    this.el.width = Math.max(1, w);
    this.el.height = Math.max(1, h);
    this.el.style.width = this.el.width * scale + 'px';
    this.el.style.height = this.el.height * scale + 'px';
    const ctx = this.el.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    paint(ctx);
  }
}

/** paint text at (x, y) with a shadow one pixel below */
function paintText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, fg: string, shadow: string): void {
  const m = rasterize(s);
  for (const [dy, col] of [
    [1, shadow],
    [0, fg]
  ] as [number, string][]) {
    ctx.fillStyle = col;
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.mask[j * m.w + i]) ctx.fillRect(x + i, y + j + dy, 1, 1);
  }
}

export class Hud {
  readonly root: HTMLDivElement;
  private hearts: Piece;
  private bar: Piece;
  private lines: Piece;
  private msgs: Piece;
  private colours: Colours;

  constructor(parent: HTMLElement, palette: number[]) {
    this.colours = hudColours(palette);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    Object.assign(this.root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2' });
    parent.appendChild(this.root);
    const corner = (style: Partial<CSSStyleDeclaration>) => {
      const d = document.createElement('div');
      Object.assign(d.style, { position: 'absolute' }, style);
      this.root.appendChild(d);
      return d;
    };
    this.hearts = new Piece(corner({ left: '16px', top: '16px' }));
    this.hearts.el.id = 'hud-health';
    this.lines = new Piece(corner({ right: '16px', top: '16px' }));
    this.lines.el.id = 'hud-lines';
    // messages a third of the way down, clear of the corners' lines however long those get
    this.msgs = new Piece(corner({ left: '50%', top: '30%', transform: 'translateX(-50%)' }));
    this.msgs.el.id = 'hud-messages';
    this.bar = new Piece(corner({ right: '16px', bottom: '16px' }));
    this.bar.el.id = 'hud-abilities';
  }

  /** draw the model; `scale` is screen pixels per HUD pixel (the art pixel's size) */
  render(m: HudModel, scale: number): void {
    const c = this.colours;
    // health: a heart per point, empty ones in outline
    this.hearts.el.dataset.hp = String(m.hp);
    this.hearts.el.dataset.max = String(m.maxHp);
    this.hearts.draw(`${m.hp}/${m.maxHp}/${m.down}`, scale, m.maxHp * 8 - 1, 7, ctx => {
      for (let k = 0; k < m.maxHp; k++) {
        const full = k < m.hp && !m.down;
        for (let y = 0; y < HEART.length; y++)
          for (let x = 0; x < 7; x++) {
            if (!(HEART[y] & (1 << (6 - x)))) continue;
            const edge = y === 0 || x === 0 || x === 6 || !(HEART[y - 1] & (1 << (6 - x))) || !(HEART[y + 1] & (1 << (6 - x)));
            if (!full && !edge) continue;
            ctx.fillStyle = full ? c.accent : c.dim;
            ctx.fillRect(k * 8 + x, y, 1, 1);
          }
        ctx.fillStyle = c.dark;
        for (let x = 1; x < 6; x++) if (full) ctx.fillRect(k * 8 + x, 6, 1, 1); // a shadow under a full heart
      }
    });
    // abilities: a box per ability, filling up as it gets ready, its key in it
    const BOX = 11;
    this.bar.el.dataset.ready = m.abilities.map(a => a.key + ':' + a.ready.toFixed(2)).join(' ');
    this.bar.draw(m.abilities.map(a => a.key + Math.round(a.ready * 10)).join(','), scale, Math.max(1, m.abilities.length * (BOX + 3) - 3), BOX, ctx => {
      m.abilities.forEach((a, k) => {
        const x0 = k * (BOX + 3);
        ctx.fillStyle = c.dark;
        ctx.fillRect(x0, 0, BOX, BOX);
        const fill = Math.round((BOX - 2) * a.ready);
        ctx.fillStyle = a.ready >= 1 ? c.dim : c.dark;
        ctx.fillRect(x0 + 1, 1 + (BOX - 2 - fill), BOX - 2, fill);
        ctx.fillStyle = a.ready >= 1 ? c.light : c.dim;
        ctx.fillRect(x0, 0, BOX, 1);
        ctx.fillRect(x0, BOX - 1, BOX, 1);
        ctx.fillRect(x0, 0, 1, BOX);
        ctx.fillRect(x0 + BOX - 1, 0, 1, BOX);
        paintText(ctx, a.key, x0 + 3, 2, a.ready >= 1 ? c.light : c.dim, c.dark);
      });
    });
    // the game's lines, right-aligned
    this.lines.el.dataset.text = m.lines.join('\n');
    const lw = Math.max(1, ...m.lines.map(l => rasterize(l).w));
    this.lines.draw(m.lines.join('\n'), scale, lw, Math.max(1, m.lines.length * (GLYPH_H + 3)), ctx => {
      m.lines.forEach((l, k) => paintText(ctx, l, lw - rasterize(l).w, k * (GLYPH_H + 3), c.light, c.dark));
    });
    // messages, centred, the newest at the bottom; they blink out in their last half second
    const live = m.messages.filter(x => x.age < MESSAGE_LIFE - 0.5 || Math.floor(x.age * 8) % 2 === 0);
    this.msgs.el.dataset.text = m.messages.map(x => x.text).join('\n');
    const mw = Math.max(1, ...live.map(x => rasterize(x.text).w));
    this.msgs.draw(live.map(x => x.text).join('\n'), scale, mw, Math.max(1, live.length * (GLYPH_H + 3)), ctx => {
      live.forEach((x, k) => paintText(ctx, x.text, Math.floor((mw - rasterize(x.text).w) / 2), k * (GLYPH_H + 3), c.light, c.dark));
    });
  }
}
