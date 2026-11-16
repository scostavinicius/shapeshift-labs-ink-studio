// Putting a world at a moment, exactly as the toolkit's own CLI does it (cli/ink-studio.js build() and pose()), so a world
// posed here in the browser and one posed in Node by the parity harness are the same splats. Plain JavaScript on purpose:
// the harness imports it in Node as it stands, and esbuild bundles it into the page.

/**
 * Get a freshly built world ready to be posed: a world that remembers the past is started at time 0 (as the CLI does).
 * @param {import('../../types/ink-studio').World} world
 */
export function start(world) {
  world.clock = 0;
  if (world.anim && world.anim.stateful) world.anim.update(0, 0);
}

/**
 * Put the world at time t. A stateful world is walked there a sixtieth of a second at a time and can only go forward;
 * a stateless one is set straight to t. Splats carried by bones are put in place in a copy (world.data), the rest pose
 * being kept in world.rest, as the CLI does for its pictures.
 * @param {import('../../types/ink-studio').World} world
 * @param {number} t
 * @param {import('../../types/ink-studio').Kit} K
 */
export function poseAt(world, t, K) {
  const anim = world.anim;
  if (!anim) return;
  const w = /** @type {any} */ (world);
  if (anim.stateful) {
    if (t < w.clock - 1e-9) throw new Error('this world cannot be run backwards: ask for times in order');
    while (w.clock < t - 1e-9) {
      const dt = Math.min(1 / 60, t - w.clock);
      w.clock += dt;
      anim.update(dt, w.clock);
    }
  } else anim.update(1 / 60, t);
  w.clock = t;
  if (anim.bones) {
    if (!w.rest) w.rest = world.data;
    world.data = K.bones.posed({
      data: w.rest,
      anim,
      get posedBuf() {
        return w.posedBuf;
      },
      set posedBuf(v) {
        w.posedBuf = v;
      }
    });
  }
}
