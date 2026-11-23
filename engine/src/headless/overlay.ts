// The HUD's text on a headless picture: the player's health and the game's own lines (def.hud.lines), in the engine's
// pixel font, top left, so a `shot` shows what the page would. (The page's HUD draws hearts and the ability bar; a
// picture for reading says it in words.)
import type { RunningGame } from '../game/game';
import { GLYPH_H, rasterize } from '../ui/font';
import { gameLines, hudColours } from '../ui/hud';

/** what the HUD says, as lines of text */
export function hudLines(game: RunningGame<any>): string[] {
  const out: string[] = [];
  const p = game.player;
  if (p) {
    const def = game.def.actors && game.def.actors[p.actor];
    const max = (def && def.hp) || (p.ch.spec && (p.ch.spec.hp as number)) || 3;
    out.push(p.deadFor >= 0 ? `HP 0/${max} DOWN` : `HP ${Math.max(0, p.hp)}/${max}`);
  }
  out.push(...gameLines(game));
  return out;
}

const rgbOf = (css: string): [number, number, number] => {
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** draw lines of text into an rgb picture (w x h x 3), top left, `scale` screen pixels to a font pixel */
export function overlayText(img: { w: number; h: number; rgb: Uint8Array }, lines: string[], scale: number, palette: number[]): void {
  const c = hudColours(palette),
    fg = rgbOf(c.light),
    bg = rgbOf(c.dark);
  const put = (x: number, y: number, col: [number, number, number]) => {
    for (let j = 0; j < scale; j++)
      for (let i = 0; i < scale; i++) {
        const px = x * scale + i + 2 * scale,
          py = y * scale + j + 2 * scale;
        if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
        const o = (py * img.w + px) * 3;
        img.rgb[o] = col[0];
        img.rgb[o + 1] = col[1];
        img.rgb[o + 2] = col[2];
      }
  };
  lines.forEach((line, k) => {
    const m = rasterize(line),
      y0 = k * (GLYPH_H + 3);
    for (const [dy, col] of [
      [1, bg],
      [0, fg]
    ] as [number, [number, number, number]][])
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) put(x, y0 + y + dy, col);
  });
}
