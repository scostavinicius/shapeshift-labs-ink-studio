// Camera impulses (stage 20): the picture jolts when the player is hit, lands a blow, smashes something or fells an
// enemy. Made with the toolkit's KIT.cameraImpulses (docs/camera-impulses.md) and applied by its renderer to the drawn
// view only: clicks are traced through the engine's own view (core.shown), which never shakes, and nothing here is part
// of the game, so the simulation and its hash are untouched. Like the HUD and the sound, it reads the game's events
// between steps.
import type { Kit, Vec3 } from '../../types/ink-studio';
import type { GameEvent } from '../game/types';

interface EntityLike {
  id: number;
  pos: Vec3;
  brain?: unknown;
}
interface GameLike {
  readonly entities: readonly EntityLike[];
  readonly player: EntityLike | null;
}

export class CameraShake {
  /** the toolkit's impulse provider: handed to the renderer with each frame (frame.cameraImpulses) */
  readonly motion: any;
  private preset: (name: string, o: object) => object;

  /** scale: 1 the default, 0.5 gentler, 0 none */
  constructor(
    K: Kit,
    private scale = 1
  ) {
    const C = (K as any).cameraImpulses;
    this.motion = C.create({ seed: 73, translationLimit: 0.6 * scale, rotationLimit: 0.12 * scale });
    this.preset = C.preset;
  }

  private emit(name: 'recoil' | 'crash', time: number, weight: number, source?: Vec3): void {
    if (this.scale <= 0) return;
    this.motion.emit(this.preset(name, { time, weight: weight * this.scale, ...(source && { source: [source[0], source[1] + 0.8, source[2]] }) }));
  }

  /** What the step's events mean for the camera. */
  events(events: readonly GameEvent[], game: GameLike): void {
    const at = (id: unknown) => game.entities.find(e => e.id === id)?.pos;
    const player = game.player;
    for (const e of events) {
      const d = (e.data || {}) as Record<string, unknown>;
      if (e.name === 'hit') {
        if (player && d.target === player.id) this.emit('crash', e.t, 0.55, at(d.by) ?? player.pos);
        else if (player && d.by === player.id) this.emit('recoil', e.t, 0.22);
      } else if (e.name === 'break') this.emit('crash', e.t, 0.7, (d.at as Vec3) ?? undefined);
      else if (e.name === 'death' && player && d.by === player.id) this.emit('recoil', e.t, 0.35);
    }
  }
}
