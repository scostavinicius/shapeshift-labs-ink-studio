// Back-to-front order of the splats for a view, worked out as cli/render.js does: each splat's place at this moment (the
// motions that move it: the same arithmetic as the reference, in doubles), its depth in view space stored as a float32,
// the "back" splats pushed to the farthest depth, then a stable sort by depth. The reference uses a stable comparison
// sort; a least-significant-digit radix sort on the float bits is stable too, so ties come out in the same order.
// Splats carried by bones are put in place first, as the shader does (and as K.bones.posed does on the CPU).

/** What the sort needs of a world and of a view: plain data, so it can also run in a worker on a copy. */
export interface SortWorld {
  data: Float32Array;
  count: number;
  back?: Int32Array | null;
}
export interface SortView {
  t: number;
  V: ArrayLike<number>;
}

export interface OrderScratch {
  depth: Float32Array;
  keys: Uint32Array;
  order: Uint32Array;
  tmp: Uint32Array;
  counts: Uint32Array;
}

export function makeScratch(n: number): OrderScratch {
  const depth = new Float32Array(n);
  return {
    depth,
    keys: new Uint32Array(depth.buffer),
    order: new Uint32Array(n),
    tmp: new Uint32Array(n),
    counts: new Uint32Array(65536)
  };
}

/**
 * Fill s.order with splat indices, farthest first. Returns s.order.
 * bones: 12 floats a bone (anim.bones) when the data holds bone-carried splats at rest; null when there are none.
 */
export function sortSplats(world: SortWorld, view: SortView, s: OrderScratch, bones: ArrayLike<number> | null = null): Uint32Array {
  const d = world.data,
    N = world.count,
    t = view.t,
    V = view.V,
    v2 = V[2],
    v6 = V[6],
    v10 = V[10],
    v14 = V[14],
    depth = s.depth;
  let mn = Infinity;
  for (let i = 0, q = 0; i < N; i++, q += 16) {
    let x = d[q],
      y = d[q + 1],
      z = d[q + 2];
    let kind = Math.round(d[q + 11]) % 16;
    if (kind > 1) {
      let ph = d[q + 12],
        sp = d[q + 13],
        rg = d[q + 14];
      const ex = d[q + 15];
      if (kind === 12 || kind === 13) {
        if (bones) {
          const k = ph * 12,
            x0 = x,
            y0 = y,
            z0 = z;
          x = bones[k] * x0 + bones[k + 1] * y0 + bones[k + 2] * z0 + bones[k + 9];
          y = bones[k + 3] * x0 + bones[k + 4] * y0 + bones[k + 5] * z0 + bones[k + 10];
          z = bones[k + 6] * x0 + bones[k + 7] * y0 + bones[k + 8] * z0 + bones[k + 11];
          if (rg > 0) {
            const m = sp * 12;
            x += (bones[m] * x0 + bones[m + 1] * y0 + bones[m + 2] * z0 + bones[m + 9] - x) * rg;
            y += (bones[m + 3] * x0 + bones[m + 4] * y0 + bones[m + 5] * z0 + bones[m + 10] - y) * rg;
            z += (bones[m + 6] * x0 + bones[m + 7] * y0 + bones[m + 8] * z0 + bones[m + 11] - z) * rg;
          }
          // (the reference keeps posed splats as float32 before it moves them further)
          x = Math.fround(x);
          y = Math.fround(y);
          z = Math.fround(z);
        }
        if (kind === 13) {
          kind = 11;
          ph = 1;
          sp = 1.9;
          rg = 0.022;
        } else kind = 0;
      }
      if (kind === 2) {
        const f = (t * sp) / rg + ph;
        y -= (f - Math.floor(f)) * rg;
      } else if (kind === 3) {
        const f = (t * sp) / rg + ph,
          pr = f - Math.floor(f);
        y += pr * rg;
        x += Math.sin(pr * 7 + ph * 50) * 0.25 * pr;
      } else if (kind === 5) {
        const a = t * sp,
          cs = Math.cos(a),
          sn = Math.sin(a),
          nx = cs * x + sn * z;
        z = -sn * x + cs * z;
        x = nx;
      } else if (kind === 6) y += Math.sin(t * sp + ph) * rg;
      else if (kind === 8) {
        const f = 0.2 + 0.8 * Math.abs(Math.sin(t * sp + ph));
        x = rg + (x - rg) * f;
        z = ex + (z - ex) * f;
        y += 0.14 * Math.sin(t * sp * 0.31 + ph);
      } else if (kind === 9) {
        const k = 1 + rg * Math.sin(t * sp + ph - y * ex);
        x *= k;
        z *= k;
      } else if (kind === 15) {
        const f = (t * sp) / rg + ph,
          pr = f - Math.floor(f);
        y -= pr * rg;
        x += Math.sin(pr * 11 + ph * 40) * ex;
        z += Math.cos(pr * 7 + ph * 23) * ex * 0.6;
      } else if (kind === 14) {
        const hg = Math.max(0, y - ex);
        x += rg * hg * Math.sin(t * sp + ph);
        z += rg * 0.6 * hg * Math.sin(t * sp * 0.73 + ph * 1.7);
      } else if (kind === 11) {
        const x0 = x;
        x += rg * Math.sin(t * sp + y * 1.3 + z * 0.9 + ph);
        y += rg * 0.6 * Math.sin(t * sp * 1.3 + x0 * 1.1 + ph);
      }
    }
    depth[i] = v2 * x + v6 * y + v10 * z + v14;
  }
  // the minimum of the stored (float32) depths, as the reference takes it
  for (let i = 0; i < N; i++) if (depth[i] < mn) mn = depth[i];
  const back = world.back;
  if (back) for (let j = 0; j < back.length; j++) depth[back[j]] = mn;

  // float bits to keys that sort as unsigned integers: flip the sign bit of positives, all bits of negatives
  const keys = s.keys;
  for (let i = 0; i < N; i++) {
    const b = keys[i];
    keys[i] = (b ^ ((b >> 31) | 0x80000000)) >>> 0;
  }
  // two stable passes of 16 bits
  const counts = s.counts,
    tmp = s.tmp,
    order = s.order;
  counts.fill(0);
  for (let i = 0; i < N; i++) counts[keys[i] & 0xffff]++;
  for (let k = 0, sum = 0; k < 65536; k++) {
    const c = counts[k];
    counts[k] = sum;
    sum += c;
  }
  for (let i = 0; i < N; i++) tmp[counts[keys[i] & 0xffff]++] = i;
  counts.fill(0);
  for (let i = 0; i < N; i++) counts[keys[i] >>> 16]++;
  for (let k = 0, sum = 0; k < 65536; k++) {
    const c = counts[k];
    counts[k] = sum;
    sum += c;
  }
  for (let j = 0; j < N; j++) {
    const i = tmp[j];
    order[counts[keys[i] >>> 16]++] = i;
  }
  return order;
}
