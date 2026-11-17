// The same game, in Node, with a script for input (docs/engine-stage6-design.md §5). Steps it exactly as the page does
// (the stage 5 core, fixed steps), with bones posed on the CPU since the terminal renderer does not carry them.
// Drawing is left to the caller (cli.js uses cli/render.js), so this file has no Node imports and is bundled for tests too.
import type { Ink } from '../../types/ink-studio';
import { createGame, type RunningGame } from '../game/game';
import type { SceneFn } from '../game/level';
import { ScriptPlayer } from '../game/script';
import type { GameDef, Script } from '../game/types';

export interface HeadlessRun<State = unknown> {
  game: RunningGame<State>;
  script: ScriptPlayer;
  /** the hash after every step, if asked for */
  hashes: string[];
}

/**
 * Build the game and run it to time t (rounded to a whole step), feeding the script's events in step by step. Clicks are
 * worked out through the view of the camera just before the step, on a stage of the script's size.
 */
export function runHeadless<State>(
  def: GameDef<State>,
  ink: Ink,
  scene: SceneFn,
  script: Script,
  t: number,
  o: { hashEachStep?: boolean; bones?: 'cpu' | 'gpu' } = {}
): HeadlessRun<State> {
  const player = new ScriptPlayer(script);
  const game = createGame(def, ink, { scene, seed: script.seed, bones: o.bones || 'cpu' });
  const steps = Math.round(t * 60),
    { w, h } = player.view,
    hashes: string[] = [];
  for (let n = 0; n < steps; n++) {
    game.core.shown = game.core.view(w, h);
    game.runSteps(1, k => player.apply(k, game.core.input));
    if (o.hashEachStep) hashes.push(game.hash());
  }
  game.core.shown = game.core.view(w, h);
  return { game, script: player, hashes };
}
