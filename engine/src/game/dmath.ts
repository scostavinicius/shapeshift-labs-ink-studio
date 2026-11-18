// Deterministic Math: the transcendental functions of JavaScript's Math, written out in plain arithmetic so that every
// JavaScript engine (every version of V8, SpiderMonkey, JavaScriptCore, Node and every browser) gives the same result to
// the last bit. While a game builds and steps, the engine puts these in Math's place (rng.ts Dice.during), the way it
// does with Math.random: see docs/engine-determinism.md for why, and for what a port of the engine to another language
// must reproduce.
//
// Why: the ECMAScript standard fixes +, -, *, /, sqrt, floor, round, abs, min, max ... to the bit (they are IEEE 754
// operations), but leaves sin, cos, exp, log, atan2, pow, cbrt, hypot ... "implementation-approximated". Engines do
// differ: Node 24 (V8 13.6) and Edge 157 disagree in the last bit for 3% to 18% of inputs to most of them (measured at
// stage 7), which is enough to make a recorded fight play out differently.
//
// How: these are ports of fdlibm 5.3 (Sun Microsystems, 1993; the library V8 itself used, and the reference behind
// Java's StrictMath), using only the operations the standard fixes, plus reading and writing the two 32-bit halves of a
// double. Each is within 1 ulp of the true result (fdlibm's own bound); they are not always the bit the native function
// gives, but they are always the same bit. Arguments to sin/cos/tan beyond 2^19 * pi/2 are reduced with BigInt (exact
// everywhere) instead of fdlibm's __kernel_rem_pio2. hypot is the plain scaled sum (not fdlibm's), in argument order.
//
// The fdlibm notice: Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun
// Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software is freely granted, provided
// that this notice is preserved.

// ---------------------------------------------------------------------------------------------------------- the bits

const F = new Float64Array(1),
  W = new Int32Array(F.buffer),
  LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1,
  HI = LITTLE ? 1 : 0,
  LO = LITTLE ? 0 : 1;
/** the high 32 bits of a double (sign, exponent, top of the fraction), as a signed int */
const hiw = (x: number) => ((F[0] = x), W[HI]);
/** the low 32 bits, as a signed int */
const low = (x: number) => ((F[0] = x), W[LO]);
/** the double with these halves */
const make = (h: number, l: number) => ((W[HI] = h), (W[LO] = l), F[0]);
/** x with its low 32 bits cleared */
const clearLo = (x: number) => ((F[0] = x), (W[LO] = 0), F[0]);
/** x with its high word replaced */
const withHi = (x: number, h: number) => ((F[0] = x), (W[HI] = h), F[0]);

const fabs = (x: number) => (x < 0 ? -x : x === 0 ? 0 : x);
const one = 1,
  huge = 1e300,
  tiny = 1e-300;

/** scale x by 2^n exactly (fdlibm s_scalbn) */
export function scalbn(x: number, n: number): number {
  const two54 = 1.8014398509481984e16,
    twom54 = 5.551115123125783e-17;
  let hx = hiw(x);
  const lx = low(x);
  let k = (hx & 0x7ff00000) >> 20;
  if (k === 0) {
    if ((lx | (hx & 0x7fffffff)) === 0) return x;
    x *= two54;
    hx = hiw(x);
    k = ((hx & 0x7ff00000) >> 20) - 54;
    if (n < -50000) return tiny * x;
  }
  if (k === 0x7ff) return x + x;
  k = k + n;
  if (k > 0x7fe) return huge * (x < 0 ? -huge : huge);
  if (k > 0) return make((hx & 0x800fffff) | (k << 20), low(x));
  if (k <= -54) {
    if (n > 50000) return huge * (x < 0 ? -huge : huge);
    return tiny * (x < 0 ? -tiny : tiny);
  }
  k += 54;
  return make((hx & 0x800fffff) | (k << 20), low(x)) * twom54;
}

// ---------------------------------------------------------------------------------------------------------- sin, cos, tan

function kSin(x: number, y: number, iy: number): number {
  const S1 = -1.66666666666666324348e-1,
    S2 = 8.33333333332248946124e-3,
    S3 = -1.98412698298579493134e-4,
    S4 = 2.75573137070700676789e-6,
    S5 = -2.50507602534068634195e-8,
    S6 = 1.58969099521155010221e-10;
  const ix = hiw(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x,
    v = z * x,
    r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

function kCos(x: number, y: number): number {
  const C1 = 4.16666666666666019037e-2,
    C2 = -1.38888888888741095749e-3,
    C3 = 2.48015872894767294178e-5,
    C4 = -2.75573143513906633035e-7,
    C5 = 2.08757232129817482790e-9,
    C6 = -1.13596475577881948265e-11;
  const ix = hiw(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return one;
  const z = x * x,
    r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return one - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : make(ix - 0x00200000, 0),
    hz = 0.5 * z - qx,
    a = one - qx;
  return a - (hz - (z * r - x * y));
}

const T = [
  3.33333333333334091986e-1, 1.33333333333201242699e-1, 5.39682539762260521377e-2, 2.18694882948595424599e-2,
  8.86323982359930005737e-3, 3.59207910759131235356e-3, 1.45620945432529025516e-3, 5.88041240820264096874e-4,
  2.46463134818469906812e-4, 7.8179444293955709230e-5, 7.14072491382608190305e-5, -1.85586374855275456654e-5,
  2.59073051863633712884e-5
];

function kTan(x: number, y: number, iy: number): number {
  const pio4 = 7.85398163397448278999e-1,
    pio4lo = 3.06161699786838301793e-17;
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  let z: number, w: number, r: number, v: number, s: number, t: number, a: number;
  if (ix < 0x3e300000 && (x | 0) === 0) {
    if (((ix | low(x)) | (iy + 1)) === 0) return one / fabs(x);
    if (iy === 1) return x;
    w = x + y;
    z = clearLo(w);
    v = y - (z - x);
    t = a = -one / w;
    t = clearLo(t);
    s = one + t * z;
    return t + a * (s + t * v);
  }
  if (ix >= 0x3fe59428) {
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    z = pio4 - x;
    w = pio4lo - y;
    x = z + w;
    y = 0;
  }
  z = x * x;
  w = z * z;
  r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3fe59428) {
    v = iy;
    return (1 - ((hx >> 30) & 2)) * (v - 2 * (x - ((w * w) / (w + v) - r)));
  }
  if (iy === 1) return w;
  z = clearLo(w);
  v = r - (z - x);
  t = a = -1 / w;
  t = clearLo(t);
  s = 1 + t * z;
  return t + a * (s + t * v);
}

// x reduced to y0 + y1 in [-pi/4, pi/4] with x = n * pi/2 + y0 + y1; returns n
const RED: [number, number] = [0, 0];

function remPio2(x: number): number {
  const invpio2 = 6.36619772367581382433e-1,
    pio2_1 = 1.57079632673412561417,
    pio2_1t = 6.07710050650619224932e-11,
    pio2_2 = 6.07710050630396597660e-11,
    pio2_2t = 2.02226624879595063154e-21,
    pio2_3 = 2.02226624871116645580e-21,
    pio2_3t = 8.47842766036889956997e-32;
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  let z: number;
  if (ix <= 0x3fe921fb) {
    RED[0] = x;
    RED[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4: one step of pi/2 (with more of pi/2 if x is near it)
    if (hx > 0) {
      z = x - pio2_1;
      if (ix !== 0x3ff921fb) {
        RED[0] = z - pio2_1t;
        RED[1] = z - RED[0] - pio2_1t;
      } else {
        z -= pio2_2;
        RED[0] = z - pio2_2t;
        RED[1] = z - RED[0] - pio2_2t;
      }
      return 1;
    }
    z = x + pio2_1;
    if (ix !== 0x3ff921fb) {
      RED[0] = z + pio2_1t;
      RED[1] = z - RED[0] + pio2_1t;
    } else {
      z += pio2_2;
      RED[0] = z + pio2_2t;
      RED[1] = z - RED[0] + pio2_2t;
    }
    return -1;
  }
  if (ix <= 0x413921fb) {
    // |x| <= 2^19 * pi/2: Cody and Waite, with up to three pieces of pi/2
    let t = fabs(x);
    const n = (t * invpio2 + 0.5) | 0,
      fn = n;
    let r = t - fn * pio2_1,
      w = fn * pio2_1t;
    const j = ix >> 20;
    RED[0] = r - w;
    let i = j - ((hiw(RED[0]) >> 20) & 0x7ff);
    if (i > 16) {
      t = r;
      w = fn * pio2_2;
      r = t - w;
      w = fn * pio2_2t - (t - r - w);
      RED[0] = r - w;
      i = j - ((hiw(RED[0]) >> 20) & 0x7ff);
      if (i > 49) {
        t = r;
        w = fn * pio2_3;
        r = t - w;
        w = fn * pio2_3t - (t - r - w);
        RED[0] = r - w;
      }
    }
    RED[1] = r - RED[0] - w;
    if (hx < 0) {
      RED[0] = -RED[0];
      RED[1] = -RED[1];
      return -n;
    }
    return n;
  }
  if (ix >= 0x7ff00000) {
    RED[0] = RED[1] = x - x;
    return 0;
  }
  return remPio2Big(x);
}

// --- huge arguments: x * 2/pi worked out exactly with BigInt (a fixed point 2/pi of PREC bits, made once, by Machin)
const PREC = 1280n;
let twoOverPi: bigint | null = null;

function atanInv(n: bigint, bits: bigint): bigint {
  // atan(1/n) * 2^bits, by its series
  const one_ = 1n << bits,
    n2 = n * n;
  let term = one_ / n,
    sum = term,
    k = 1n,
    sign = -1n;
  while (term !== 0n) {
    term /= n2;
    const add = term / (2n * k + 1n);
    if (add === 0n) break;
    sum += sign * add;
    sign = -sign;
    k++;
  }
  return sum;
}

function getTwoOverPi(): bigint {
  if (twoOverPi === null) {
    const bits = PREC + 64n,
      pi = 16n * atanInv(5n, bits) - 4n * atanInv(239n, bits); // pi * 2^bits
    twoOverPi = (1n << (bits + PREC + 1n)) / pi; // (2/pi) * 2^PREC
  }
  return twoOverPi;
}

/** a * b as an exact sum hi + lo (Dekker's product, with Veltkamp's split: plain arithmetic only) */
function twoProd(a: number, b: number): [number, number] {
  const p = a * b,
    SPLIT = 134217729, // 2^27 + 1
    ca = SPLIT * a,
    ah = ca - (ca - a),
    al = a - ah,
    cb = SPLIT * b,
    bh = cb - (cb - b),
    bl = b - bh;
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

function remPio2Big(x: number): number {
  const neg = x < 0,
    ax = fabs(x);
  // ax = M * 2^E with M a 53-bit integer
  const hx = hiw(ax),
    e = ((hx >> 20) & 0x7ff) - 1075,
    M = (BigInt((hx & 0x000fffff) | 0x00100000) << 32n) | BigInt(low(ax) >>> 0);
  const Q = M * getTwoOverPi(), // ax * 2/pi * 2^(PREC - e)
    S = PREC - BigInt(e),
    mask = (1n << S) - 1n;
  let N = Q >> S,
    Fr = Q & mask; // fraction Fr / 2^S of a quarter turn
  // to the nearest quarter: the remainder in [-1/2, 1/2)
  let sign = 1;
  if (Fr >> (S - 1n)) {
    N += 1n;
    Fr = (1n << S) - Fr;
    sign = -1;
  }
  // Fr / 2^S as a double-double fh + fl
  const fh = Number(Fr >> (S - 53n)) / 9007199254740992,
    fl = Number((Fr >> (S - 106n)) & ((1n << 53n) - 1n)) / (9007199254740992 * 9007199254740992);
  // times pi/2
  const PIO2_H = 1.5707963267948966,
    PIO2_L = 6.123233995736766e-17;
  const [p, pe] = twoProd(fh, PIO2_H);
  const tail = pe + fh * PIO2_L + fl * PIO2_H;
  let y0 = p + tail,
    y1 = tail - (y0 - p);
  if (sign < 0) {
    y0 = -y0;
    y1 = -y1;
  }
  let n = Number(N & 3n);
  if (neg) {
    y0 = -y0;
    y1 = -y1;
    n = -n;
  }
  RED[0] = y0;
  RED[1] = y1;
  return n;
}

export function sin(x: number): number {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kSin(RED[0], RED[1], 1);
    case 1:
      return kCos(RED[0], RED[1]);
    case 2:
      return -kSin(RED[0], RED[1], 1);
    default:
      return -kCos(RED[0], RED[1]);
  }
}

export function cos(x: number): number {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kCos(RED[0], RED[1]);
    case 1:
      return -kSin(RED[0], RED[1], 1);
    case 2:
      return -kCos(RED[0], RED[1]);
    default:
      return kSin(RED[0], RED[1], 1);
  }
}

export function tan(x: number): number {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kTan(RED[0], RED[1], 1 - ((n & 1) << 1));
}

// ---------------------------------------------------------------------------------------------------------- atan, atan2, asin, acos

const atanhi = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2
];

export function atan(x: number): number {
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && low(x) !== 0)) return x + x;
    return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000 && huge + x > one) return x;
    id = -1;
  } else {
    x = fabs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - one) / (2 + x);
      } else {
        id = 1;
        x = (x - one) / (x + one);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (one + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x,
    w = z * z,
    s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10]))))),
    s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = atanhi[id] - (x * (s1 + s2) - atanlo[id] - x);
  return hx < 0 ? -r : r;
}

export function atan2(y: number, x: number): number {
  const pi_o_4 = 7.8539816339744827900e-1,
    pi_o_2 = 1.5707963267948965580,
    pi = 3.1415926535897931160,
    pi_lo = 1.2246467991473531772e-16;
  if (x !== x || y !== y) return x + y;
  const hx = hiw(x),
    ix = hx & 0x7fffffff,
    lx = low(x) >>> 0,
    hy = hiw(y),
    iy = hy & 0x7fffffff,
    ly = low(y) >>> 0;
  if (hx === 0x3ff00000 && lx === 0) return atan(y); // x = 1
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) {
    // y = +-0
    switch (m) {
      case 0:
      case 1:
        return y;
      case 2:
        return pi + tiny;
      default:
        return -pi - tiny;
    }
  }
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return pi_o_4 + tiny;
        case 1:
          return -pi_o_4 - tiny;
        case 2:
          return 3 * pi_o_4 + tiny;
        default:
          return -3 * pi_o_4 - tiny;
      }
    }
    switch (m) {
      case 0:
        return 0;
      case 1:
        return -0;
      case 2:
        return pi + tiny;
      default:
        return -pi - tiny;
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) {
    z = pi_o_2 + 0.5 * pi_lo;
    m &= 1;
  } else if (hx < 0 && k < -60) z = 0;
  else z = atan(fabs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return pi - (z - pi_lo);
    default:
      return z - pi_lo - pi;
  }
}

const pio2_hi = 1.57079632679489655800,
  pio2_lo = 6.12323399573676603587e-17,
  pio4_hi = 7.85398163397448278999e-1,
  pS0 = 1.66666666666666657415e-1,
  pS1 = -3.25565818622400915405e-1,
  pS2 = 2.01212532134862925881e-1,
  pS3 = -4.00555345006794114027e-2,
  pS4 = 7.91534994289814532176e-4,
  pS5 = 3.47933107596021167570e-5,
  qS1 = -2.40339491173441421878,
  qS2 = 2.02094576023350569471,
  qS3 = -6.88283971605453293030e-1,
  qS4 = 7.70381505559019352791e-2;
const pR = (t: number) => t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
const qR = (t: number) => one + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));

export function asin(x: number): number {
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  let t: number, w: number, p: number, q: number;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return x * pio2_hi + x * pio2_lo; // +-1
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000 && huge + x > one) return x;
    t = x * x;
    w = pR(t) / qR(t);
    return x + x * w;
  }
  w = one - fabs(x);
  t = w * 0.5;
  p = pR(t);
  q = qR(t);
  const s = Math_sqrt(t);
  if (ix >= 0x3fef3333) {
    w = p / q;
    t = pio2_hi - (2 * (s + s * w) - pio2_lo);
  } else {
    w = clearLo(s);
    const c = (t - w * w) / (s + w),
      r = p / q;
    p = 2 * s * r - (pio2_lo - 2 * c);
    q = pio4_hi - 2 * w;
    t = pio4_hi - (p - q);
  }
  return hx > 0 ? t : -t;
}

export function acos(x: number): number {
  const pi = 3.14159265358979311600;
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return hx > 0 ? 0 : pi + 2 * pio2_lo;
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return pio2_hi + pio2_lo;
    const z = x * x,
      r = pR(z) / qR(z);
    return pio2_hi - (x - (pio2_lo - x * r));
  }
  if (hx < 0) {
    const z = (one + x) * 0.5,
      s = Math_sqrt(z),
      r = pR(z) / qR(z),
      w = r * s - pio2_lo;
    return pi - 2 * (s + w);
  }
  const z = (one - x) * 0.5,
    s = Math_sqrt(z),
    df = clearLo(s),
    c = (z - df * df) / (s + df),
    r = pR(z) / qR(z),
    w = r * s + c;
  return 2 * (df + w);
}

// ---------------------------------------------------------------------------------------------------------- exp, expm1, log

const ln2HI = [6.93147180369123816490e-1, -6.93147180369123816490e-1],
  ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10],
  invln2 = 1.44269504088896338700,
  P1 = 1.66666666666666019037e-1,
  P2 = -2.77777777770155933842e-3,
  P3 = 6.61375632143793436117e-5,
  P4 = -1.65339022054652515390e-6,
  P5 = 4.13813679705723846039e-8;

export function exp(x: number): number {
  const o_threshold = 7.09782712893383973096e2,
    u_threshold = -7.45133219101941108420e2,
    twom1000 = 9.33263618503218878990e-302;
  let hx = hiw(x);
  const xsb = (hx >> 31) & 1;
  hx &= 0x7fffffff;
  let hi = 0,
    lo = 0,
    k = 0;
  if (hx >= 0x40862e42) {
    // |x| >= 709.78
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | low(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > o_threshold) return Infinity;
    if (x < u_threshold) return 0;
  }
  if (hx > 0x3fd62e42) {
    // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) {
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + (xsb ? -0.5 : 0.5)) | 0;
      const t = k;
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    if (huge + x > one) return one + x;
  } else k = 0;
  const t = x * x,
    c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return one - ((x * c) / (c - 2) - x);
  const y = one - (lo - (x * c) / (2 - c) - hi);
  if (k >= -1021) return withHi(y, hiw(y) + (k << 20));
  return withHi(y, hiw(y) + ((k + 1000) << 20)) * twom1000;
}

export function expm1(x: number): number {
  const o_threshold = 7.09782712893383973096e2,
    ln2_hi = 6.93147180369123816490e-1,
    ln2_lo = 1.90821492927058770002e-10,
    Q1 = -3.33333333333331316428e-2,
    Q2 = 1.58730158725481460165e-3,
    Q3 = -7.93650757867487942473e-5,
    Q4 = 4.00821782732936239552e-6,
    Q5 = -2.01099218183624371326e-7;
  let hx = hiw(x);
  const xsb = hx & 0x80000000;
  hx &= 0x7fffffff;
  let k = 0,
    c = 0,
    hi: number,
    lo: number,
    t: number;
  if (hx >= 0x4043687a) {
    // |x| >= 56 ln2
    if (hx >= 0x40862e42) {
      if (hx >= 0x7ff00000) {
        if (((hx & 0xfffff) | low(x)) !== 0) return x + x;
        return xsb === 0 ? x : -1;
      }
      if (x > o_threshold) return Infinity;
    }
    if (xsb !== 0 && x + tiny < 0) return tiny - one;
  }
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (xsb === 0) {
        hi = x - ln2_hi;
        lo = ln2_lo;
        k = 1;
      } else {
        hi = x + ln2_hi;
        lo = -ln2_lo;
        k = -1;
      }
    } else {
      k = (invln2 * x + (xsb === 0 ? 0.5 : -0.5)) | 0;
      t = k;
      hi = x - t * ln2_hi;
      lo = t * ln2_lo;
    }
    x = hi - lo;
    c = hi - x - lo;
  } else if (hx < 0x3c900000) {
    t = huge + x;
    return x - (t - (huge + x));
  } else k = 0;
  const hfx = 0.5 * x,
    hxs = x * hfx,
    r1 = one + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  t = 3 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  e = x * (e - c) - c;
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) {
    if (x < -0.25) return -2 * (e - (x + 0.5));
    return one + 2 * (x - e);
  }
  let y: number;
  if (k <= -2 || k > 56) {
    y = one - (e - x);
    y = withHi(y, hiw(y) + (k << 20));
    return y - one;
  }
  if (k < 20) {
    t = make(0x3ff00000 - (0x200000 >> k), 0);
    y = t - (e - x);
  } else {
    t = make((0x3ff - k) << 20, 0);
    y = x - (e + t);
    y += one;
  }
  return withHi(y, hiw(y) + (k << 20));
}

const Lg1 = 6.666666666666735130e-1,
  Lg2 = 3.999999999940941908e-1,
  Lg3 = 2.857142874366239149e-1,
  Lg4 = 2.222219843214978396e-1,
  Lg5 = 1.818357216161805012e-1,
  Lg6 = 1.531383769920937332e-1,
  Lg7 = 1.479819860511658591e-1;

export function log(x: number): number {
  const ln2_hi = 6.93147180369123816490e-1,
    ln2_lo = 1.90821492927058770002e-10,
    two54 = 1.80143985094819840000e16;
  let hx = hiw(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54;
    x *= two54;
    hx = hiw(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = make(hx | (i ^ 0x3ff00000), low(x)); // normalise x or x/2
  k += i >> 20;
  const f = x - 1;
  let dk: number;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0) {
      if (k === 0) return 0;
      dk = k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    dk = k;
    return dk * ln2_hi - (R - dk * ln2_lo - f);
  }
  const s = f / (2 + f);
  dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z,
    j = 0x6b851 - hx,
    t1 = w * (Lg2 + w * (Lg4 + w * Lg6)),
    t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
}

/** x = 2^y * m with m in [1, 2) (or [0.5, 1) when the exponent is negative): [y, m], or null for 0, negatives, NaN, Infinity */
function split2(x: number): [number, number] | null {
  const two54 = 1.80143985094819840000e16;
  let hx = hiw(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | low(x)) === 0 || hx < 0) return null;
    k -= 54;
    x *= two54;
    hx = hiw(x);
  }
  if (hx >= 0x7ff00000) return null;
  k += (hx >> 20) - 1023;
  const i = (k & 0x80000000) >>> 31;
  return [k + i, make((hx & 0x000fffff) | ((0x3ff - i) << 20), low(x))];
}

export function log10(x: number): number {
  const ivln10 = 4.34294481903251816668e-1,
    log10_2hi = 3.01029995663611771306e-1,
    log10_2lo = 3.69423907715893078616e-13;
  const s = split2(x);
  if (!s) return x === 0 ? -Infinity : x < 0 || x !== x ? NaN : x;
  const [y, m] = s;
  return y * log10_2hi + (y * log10_2lo + ivln10 * log(m));
}

export function log2(x: number): number {
  const ivln2 = 1.44269504088896338700;
  const s = split2(x);
  if (!s) return x === 0 ? -Infinity : x < 0 || x !== x ? NaN : x;
  // m in [sqrt(1/2), sqrt(2)): a power of two gives its exponent exactly (log(1) is 0), and near 1 nothing cancels
  let [y, m] = s;
  if (m < 1) {
    m *= 2;
    y -= 1;
  }
  if (m > 1.4142135623730951) {
    m *= 0.5;
    y += 1;
  }
  return y + ivln2 * log(m);
}

export function log1p(x: number): number {
  // log(1 + x) with the rounding of 1 + x put back: exact enough, and deterministic
  if (x !== x) return x;
  if (x < -1) return NaN;
  if (x === -1) return -Infinity;
  if (x === Infinity) return x;
  const u = 1 + x;
  if (u === 1) return x;
  return (log(u) * x) / (u - 1);
}

// ---------------------------------------------------------------------------------------------------------- pow

const bp = [1, 1.5],
  dp_h = [0, 5.84962487220764160156e-1],
  dp_l = [0, 1.35003920212974897128e-8],
  L1 = 5.99999999999994648725e-1,
  L2 = 4.28571428578550184252e-1,
  L3 = 3.33333329818377432918e-1,
  L4 = 2.72728123808534006489e-1,
  L5 = 2.30660745775561754067e-1,
  L6 = 2.06975017800338417784e-1,
  lg2 = 6.93147180559945286227e-1,
  lg2_h = 6.93147182464599609375e-1,
  lg2_l = -1.90465429995776804525e-9,
  ovt = 8.0085662595372944372e-17,
  cp = 9.61796693925975554329e-1,
  cp_h = 9.61796700954437255859e-1,
  cp_l = -7.02846165095275826516e-9,
  ivln2 = 1.44269504088896338700,
  ivln2_h = 1.44269502162933349609,
  ivln2_l = 1.92596299112661746887e-8,
  two53 = 9007199254740992;

export function pow(x: number, y: number): number {
  const hx = hiw(x),
    lx = low(x) >>> 0,
    hy = hiw(y),
    ly = low(y) >>> 0;
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  // y = 0: 1, even for NaN
  if ((iy | ly) === 0) return one;
  // NaN anywhere: NaN (JavaScript: even 1 ** NaN)
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;
  // whether y is an integer, when x < 0: 0 no, 1 odd, 2 even
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) {
        const j = ly >>> (52 - k);
        if ((j << (52 - k)) >>> 0 === ly) yisint = 2 - (j & 1);
      } else if (ly === 0) {
        const j = iy >> (20 - k);
        if (j << (20 - k) === iy) yisint = 2 - (j & 1);
      }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      // y is +-Infinity
      if (((ix - 0x3ff00000) | lx) === 0) return y - y; // (+-1) ** +-Infinity is NaN
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? one / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math_sqrt(x);
  }
  let ax = fabs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    // x is +-0, +-Infinity, +-1
    let z = ax;
    if (hy < 0) z = one / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z);
      else if (yisint === 1) z = -z;
    }
    return z;
  }
  let n = (hx >> 31) + 1;
  if ((n | yisint) === 0) return (x - x) / (x - x); // (x < 0) ** (not an integer)
  let s = one;
  if ((n | (yisint - 1)) === 0) s = -one; // (x < 0) ** (odd integer)
  let t1: number, t2: number;
  if (iy > 0x41e00000) {
    // |y| > 2^31
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
      if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
    const t = ax - one,
      w = t * t * (0.5 - t * (0.3333333333333333333333 - t * 0.25)),
      u = ivln2_h * t,
      v = t * ivln2_l - w * ivln2;
    t1 = clearLo(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) {
      ax *= two53;
      n -= 53;
      ix = hiw(ax);
    }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    ix = j | 0x3ff00000;
    let k: number;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else {
      k = 0;
      n += 1;
      ix -= 0x00100000;
    }
    ax = make(ix, low(ax));
    // ax - 1 over ax + 1, in two pieces
    let u = ax - bp[k];
    let v = one / (ax + bp[k]);
    const ss = u * v,
      s_h = clearLo(ss);
    let t_h = make(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
    let t_l = ax - (t_h - bp[k]);
    const s_l = v * (u - s_h * t_h - s_h * t_l);
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = clearLo(3 + s2 + r);
    t_l = r - (t_h - 3 - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    const p_h = clearLo(u + v),
      p_l = v - (p_h - u),
      z_h = cp_h * p_h,
      z_l = cp_l * p_h + p_l * cp + dp_l[k],
      t = n;
    t1 = clearLo(z_h + z_l + dp_h[k] + t);
    t2 = z_l - (t1 - t - dp_h[k] - z_h);
  }
  // y * log2(x) as p_h + p_l
  const y1 = clearLo(y);
  let p_l = (y - y1) * t1 + y * t2;
  let p_h = y1 * t1;
  let z = p_l + p_h;
  let j = hiw(z);
  let i = low(z);
  if (j >= 0x40900000) {
    // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    // z <= -1075
    if (!((j >>> 0) === 0xc090cc00 && i === 0)) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }
  // 2 ** (p_h + p_l)
  i = j & 0x7fffffff;
  let k = (i >> 20) - 0x3ff;
  n = 0;
  if (i > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = make(n & ~(0x000fffff >> k), 0);
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  let t = clearLo(p_l + p_h);
  const u = t * lg2_h,
    v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  const w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const r = (z * t1) / (t1 - 2) - (w + z * w);
  z = one - (r - z);
  j = hiw(z);
  j += n << 20;
  if (j >> 20 <= 0) z = scalbn(z, n);
  else z = withHi(z, j);
  return s * z;
}

// ---------------------------------------------------------------------------------------------------------- cbrt, sinh, cosh, tanh, hypot

export function cbrt(x: number): number {
  const B1 = 715094163,
    B2 = 696219795,
    C = 5.42857142857142815906e-1,
    D = -7.05306122448979611050e-1,
    E = 1.41428571428571436819,
    Fc = 1.60714285714285720630,
    G = 3.57142857142857150787e-1;
  let hx = hiw(x);
  const sign = hx & 0x80000000;
  hx ^= sign;
  if (hx >= 0x7ff00000) return x + x;
  if ((hx | low(x)) === 0) return x;
  x = make(hx, low(x)); // |x|
  let t: number;
  if (hx < 0x00100000) {
    t = make(0x43500000, 0); // 2^54
    t *= x;
    t = make(((hiw(t) / 3) | 0) + B2, low(t));
  } else t = make(((hx / 3) | 0) + B1, 0);
  let r = (t * t) / x,
    s = C + r * t;
  t *= G + Fc / (s + E + D / s);
  t = make(hiw(t) + 1, 0);
  s = t * t;
  r = x / s;
  const w = t + t;
  r = (r - t) / (w + r);
  t = t + t * r;
  return sign ? -t : t;
}

export function sinh(x: number): number {
  const shuge = 1.0e307;
  const jx = hiw(x),
    ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x + x;
  const h = jx < 0 ? -0.5 : 0.5;
  if (ix < 0x40360000) {
    if (ix < 0x3e300000 && shuge + x > one) return x;
    const t = expm1(fabs(x));
    if (ix < 0x3ff00000) return h * (2 * t - (t * t) / (t + one));
    return h * (t + t / (t + one));
  }
  if (ix < 0x40862e42) return h * exp(fabs(x));
  const lx = low(x) >>> 0;
  if (ix < 0x408633ce || (ix === 0x408633ce && lx <= 0x8fb9f87d)) {
    const w = exp(0.5 * fabs(x)),
      t = h * w;
    return t * w;
  }
  return x * shuge;
}

export function cosh(x: number): number {
  const ix = hiw(x) & 0x7fffffff;
  if (ix >= 0x7ff00000) return x * x;
  if (ix < 0x3fd62e43) {
    const t = expm1(fabs(x)),
      w = one + t;
    if (ix < 0x3c800000) return w;
    return one + (t * t) / (w + w);
  }
  if (ix < 0x40360000) {
    const t = exp(fabs(x));
    return 0.5 * t + 0.5 / t;
  }
  if (ix < 0x40862e42) return 0.5 * exp(fabs(x));
  const lx = low(x) >>> 0;
  if (ix < 0x408633ce || (ix === 0x408633ce && lx <= 0x8fb9f87d)) {
    const w = exp(0.5 * fabs(x)),
      t = 0.5 * w;
    return t * w;
  }
  return huge * huge;
}

export function tanh(x: number): number {
  const jx = hiw(x),
    ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return jx >= 0 ? one / x + one : one / x - one;
  let z: number;
  if (ix < 0x40360000) {
    // |x| < 22
    if (ix < 0x3c800000) return x * (one + x);
    if (ix >= 0x3ff00000) {
      const t = expm1(2 * fabs(x));
      z = one - 2 / (t + 2);
    } else {
      const t = expm1(-2 * fabs(x));
      z = -t / (t + 2);
    }
  } else z = one - tiny;
  return jx >= 0 ? z : -z;
}

export function asinh(x: number): number {
  const ln2 = 6.93147180559945286227e-1;
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x + x;
  if (ix < 0x3e300000 && huge + x > one) return x;
  let w: number;
  if (ix > 0x41b00000) w = log(fabs(x)) + ln2;
  else if (ix > 0x40000000) {
    const t = fabs(x);
    w = log(2 * t + one / (Math_sqrt(x * x + one) + t));
  } else {
    const t = x * x;
    w = log1p(fabs(x) + t / (one + Math_sqrt(one + t)));
  }
  return hx > 0 ? w : -w;
}

export function acosh(x: number): number {
  const ln2 = 6.93147180559945286227e-1;
  const hx = hiw(x);
  if (hx < 0x3ff00000) return (x - x) / (x - x);
  if (hx >= 0x41b00000) {
    if (hx >= 0x7ff00000) return x + x;
    return log(x) + ln2;
  }
  if (((hx - 0x3ff00000) | low(x)) === 0) return 0;
  if (hx > 0x40000000) {
    const t = x * x;
    return log(2 * x - one / (x + Math_sqrt(t - one)));
  }
  const t = x - one;
  return log1p(t + Math_sqrt(2 * t + t * t));
}

export function atanh(x: number): number {
  const hx = hiw(x),
    ix = hx & 0x7fffffff;
  if (ix > 0x3ff00000 || (ix === 0x3ff00000 && low(x) !== 0)) return (x - x) / (x - x);
  if (ix === 0x3ff00000) return x / 0;
  if (ix < 0x3e300000 && huge + x > 0) return x;
  const ax = fabs(x);
  let t: number;
  if (ix < 0x3fe00000) {
    t = ax + ax;
    t = 0.5 * log1p(t + (t * ax) / (one - ax));
  } else t = 0.5 * log1p((ax + ax) / (one - ax));
  return hx >= 0 ? t : -t;
}

/** sqrt(sum of squares), scaled by the largest so nothing overflows; in argument order */
export function hypot(a?: number, b?: number, c?: number): number {
  // two and three arguments (nearly every call: 4 000 a step in the arena) without making an array: the same arithmetic,
  // in the same order, as the general case below, so the same bits (the fingerprint test holds this)
  const n = arguments.length;
  if (n === 2 || n === 3) {
    const x = +a!,
      y = +b!,
      z = n === 3 ? +c! : 0,
      ax = fabs(x),
      ay = fabs(y),
      az = fabs(z);
    if (ax === Infinity || ay === Infinity || az === Infinity) return Infinity;
    if (ax !== ax || ay !== ay || az !== az) return NaN;
    let max = 0;
    if (ax > max) max = ax;
    if (ay > max) max = ay;
    if (az > max) max = az;
    if (max === 0) return 0;
    let sum = 0;
    const qx = x / max,
      qy = y / max;
    sum += qx * qx;
    sum += qy * qy;
    if (n === 3) {
      const qz = z / max;
      sum += qz * qz;
    }
    return Math_sqrt(sum) * max;
  }
  return hypotN(Array.prototype.slice.call(arguments) as number[]);
}

/** hypot of any number of arguments */
function hypotN(args: number[]): number {
  let max = 0,
    nan = false;
  for (let i = 0; i < args.length; i++) {
    const a = fabs(+args[i]);
    if (a === Infinity) return Infinity;
    if (a !== a) nan = true;
    else if (a > max) max = a;
  }
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0;
  for (let i = 0; i < args.length; i++) {
    const q = +args[i] / max;
    sum += q * q;
  }
  return Math_sqrt(sum) * max;
}

// sqrt is exact by the standard (correctly rounded): the native one is used, saved here so the swap never touches it
const Math_sqrt = Math.sqrt;

// ---------------------------------------------------------------------------------------------------------- the swap

/** The functions put in Math's place while a game builds and steps. Everything else Math has is exact by the standard. */
export const DMATH = {
  sin,
  cos,
  tan,
  asin,
  acos,
  atan,
  atan2,
  exp,
  expm1,
  log,
  log1p,
  log2,
  log10,
  pow,
  cbrt,
  sinh,
  cosh,
  tanh,
  asinh,
  acosh,
  atanh,
  hypot
} as const;

export type DMathName = keyof typeof DMATH;
export const DMATH_NAMES = Object.keys(DMATH) as DMathName[];

/**
 * `**` is Math.pow written as an operator: a game's own code must use Math.pow (the validator of stage 9 will say so);
 * the kit (src/) uses Math.pow throughout. Math.exp and the rest are reached through Math, so the swap reaches them.
 */
export const OPERATOR_NOTE = '`**` is not swapped: write Math.pow in game code';

// ---------------------------------------------------------------------------------------------------------- the fingerprint

/**
 * A hash of what every function here gives on a fixed set of inputs (FNV-1a over the bits of the results, 64 bits as hex).
 * The same in every JavaScript engine; tests pin it, and a port of the engine to another language must give it too.
 * Inputs: a linear congruential sequence (x = x * 1664525 + 1013904223, 32 bits, from 12345) scaled into each function's
 * domain, 4096 per function, plus the special values below.
 */
export function fingerprint(): string {
  let s = 12345;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const f = new Float64Array(1),
    u = new Uint8Array(f.buffer);
  let a = 0x811c9dc5,
    b = 0xcbf29ce4;
  const put = (x: number) => {
    f[0] = x !== x ? NaN : x; // one NaN for all
    for (let i = 0; i < 8; i++) {
      const byte = u[LITTLE ? i : 7 - i];
      a = Math.imul(a ^ byte, 0x01000193) >>> 0;
      b = Math.imul(b ^ byte, 0x01000193) >>> 0;
    }
  };
  const special = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, Infinity, -Infinity, NaN, 1e-310, 1e300, 22, 710, -746, 1e22];
  const one_: [DMathName, (x: number) => number][] = [
    ['sin', x => x * 40 - 20],
    ['cos', x => x * 40 - 20],
    ['tan', x => x * 6 - 3],
    ['asin', x => x * 2 - 1],
    ['acos', x => x * 2 - 1],
    ['atan', x => x * 40 - 20],
    ['exp', x => x * 40 - 20],
    ['expm1', x => x * 4 - 2],
    ['log', x => x * 1000],
    ['log1p', x => x * 4 - 0.9],
    ['log2', x => x * 1000],
    ['log10', x => x * 1000],
    ['cbrt', x => x * 2000 - 1000],
    ['sinh', x => x * 10 - 5],
    ['cosh', x => x * 10 - 5],
    ['tanh', x => x * 10 - 5],
    ['asinh', x => x * 20 - 10],
    ['acosh', x => 1 + x * 20],
    ['atanh', x => x * 2 - 1]
  ];
  for (const [name, dom] of one_) {
    const fn = DMATH[name] as (x: number) => number;
    for (let k = 0; k < 4096; k++) put(fn(dom(r())));
    for (const x of special) put(fn(x));
  }
  for (const name of ['atan2', 'pow', 'hypot'] as const) {
    const fn = DMATH[name] as (x: number, y: number) => number;
    for (let k = 0; k < 4096; k++) {
      const x = r() * 20 - (name === 'pow' ? 0 : 10),
        y = r() * 8 - 4;
      put(fn(x, y));
    }
    for (const x of special) for (const y of special) put(fn(x, y));
  }
  // big arguments to sin and cos (the BigInt reduction)
  for (let k = 0; k < 256; k++) {
    const x = (r() - 0.5) * 1e18;
    put(sin(x));
    put(cos(x));
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
