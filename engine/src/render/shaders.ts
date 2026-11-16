// The shaders. SPLAT_* is the first loop of cli/render.js render() (a splat's place and look at this moment, its
// covariance carried to a screen ellipse, the blend into colour, depth and glass). RESOLVE_* is its second loop: glass
// bending what is behind it, contact shade, the outline, ordered noise, then the nearest palette colour.
// Anything here that differs from cli/render.js is a parity bug: the reference is the specification.

/** One splat is 4 RGBA32F texels in a data texture 2048 wide: 512 splats a row, as the stage's `rows` flags count them. */
export const DATA_WIDTH = 2048;
export const SPLATS_PER_ROW = 512;

export const SPLAT_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 a_corner;   // a unit quad: -1..1
layout(location = 1) in uint a_index;    // which splat, in back-to-front order

uniform sampler2D u_data;
uniform mat4 u_V;
uniform vec2 u_size;      // the art grid: W, H
uniform vec2 u_lim;       // limx, limy
uniform float u_t, u_focal, u_near, u_dist, u_R;
uniform vec3 u_fogCol;
uniform vec2 u_fog;       // start, max
uniform vec3 u_grow;      // rate, loop, fade

flat out vec2 v_center;
flat out vec3 v_conic;
flat out vec3 v_col;
flat out float v_al;
flat out float v_dn;
flat out int v_mode;      // bit 0: solid, bit 1: writes depth, bit 2: glass

float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

void main() {
  int i = int(a_index);
  ivec2 p = ivec2((i % ${SPLATS_PER_ROW}) * 4, i / ${SPLATS_PER_ROW});
  vec4 d0 = texelFetch(u_data, p, 0);
  vec4 d1 = texelFetch(u_data, p + ivec2(1, 0), 0);
  vec4 d2 = texelFetch(u_data, p + ivec2(2, 0), 0);
  vec4 d3 = texelFetch(u_data, p + ivec2(3, 0), 0);

  float x = d0.x, y = d0.y, z = d0.z, al = d0.w, sc = 1.0, add = 0.0, wet = 0.0;
  int kraw = int(floor(d2.w + 0.5));
  int kind = kraw % 16, flags = kraw / 16;
  float ph = d3.x, sp = d3.y, rg = d3.z, ex = d3.w, t = u_t;

  // where it is at this moment, and what it looks like
  if (kind == 1) al *= 0.62 + 0.38 * sin(t * sp + ph);
  else if (kind == 2) {
    float f = (t * sp) / rg + ph, pr = f - floor(f);
    y -= pr * rg;
    al *= 1.0 - pr * pr;
    sc *= 1.0 + pr * ex;
  } else if (kind == 3) {
    float f = (t * sp) / rg + ph, pr = f - floor(f);
    y += pr * rg;
    x += sin(pr * 7.0 + ph * 50.0) * 0.25 * pr;
    al *= (1.0 - pr) * sstep(0.0, 0.1, pr);
    sc *= 0.6 + pr * ex;
  } else if (kind == 4) add = 0.3 * sstep(0.75, 1.0, sin(t * sp + ph));
  else if (kind == 5) {
    float a = t * sp, cs = cos(a), sn = sin(a), nx = cs * x + sn * z;
    z = -sn * x + cs * z;
    x = nx;
  } else if (kind == 6) y += sin(t * sp + ph) * rg;
  else if (kind == 7) al *= 0.82 + 0.18 * sin(t * sp + ph);
  else if (kind == 8) {
    float f = 0.2 + 0.8 * abs(sin(t * sp + ph));
    x = rg + (x - rg) * f;
    z = ex + (z - ex) * f;
    y += 0.14 * sin(t * sp * 0.31 + ph);
  } else if (kind == 9) {
    float k = 1.0 + rg * sin(t * sp + ph - y * ex);
    x *= k;
    z *= k;
  } else if (kind == 15) {
    float f = (t * sp) / rg + ph, pr = f - floor(f);
    y -= pr * rg;
    x += sin(pr * 11.0 + ph * 40.0) * ex;
    z += cos(pr * 7.0 + ph * 23.0) * ex * 0.6;
    al *= sstep(0.0, 0.05, pr) * (1.0 - sstep(0.92, 1.0, pr));
  } else if (kind == 14) {
    float hg = max(0.0, y - ex);
    x += rg * hg * sin(t * sp + ph);
    z += rg * 0.6 * hg * sin(t * sp * 0.73 + ph * 1.7);
  } else if (kind == 11) {
    float x0 = x;
    x += rg * sin(t * sp + y * 1.3 + z * 0.9 + ph);
    y += rg * 0.6 * sin(t * sp * 1.3 + x0 * 1.1 + ph);
  }
  if ((kraw & 512) != 0) {
    // born: not there till its time, then it grows to its size
    float gt = t * u_grow.x;
    if (u_grow.y > 0.0) gt -= floor(gt / u_grow.y) * u_grow.y;
    float gs = min(1.0, max(0.0, (gt - ex) / u_grow.z));
    if (gs <= 0.0) al = 0.0;
    sc *= gs * (2.0 - gs);
  } else if ((kraw & 1024) != 0) wet = min(1.0, max(0.0, (t * u_grow.x - ex) / 2.0));

  if (al <= 0.0 || y < -30.0) { hide(); return; }
  vec3 cam = (u_V * vec4(x, y, z, 1.0)).xyz;
  if (cam.z > -u_near) { hide(); return; }

  float s2 = sc * sc, pk = d1.w;
  vec3 col = vec3(mod(pk, 256.0), mod(floor(pk / 256.0), 256.0), floor(pk / 65536.0)) / 255.0 + add;
  if (wet > 0.0) col *= 1.0 - vec3(0.42, 0.38, 0.3) * wet;
  float dn = clamp((-cam.z - (u_dist - u_R)) / (2.0 * u_R), 0.0, 1.0);
  if ((flags & 2) == 0 && u_fog.y > 0.0 && u_fog.x < 1.0) col += (u_fogCol - col) * (sstep(u_fog.x, 1.0, dn) * u_fog.y);

  // the covariance carried to the screen: J V S V' J', and its inverse as the ellipse's conic
  float iz = -1.0 / cam.z;
  float tx = clamp(cam.x * iz, -u_lim.x, u_lim.x) / iz;
  float ty = clamp(cam.y * iz, -u_lim.y, u_lim.y) / iz;
  float j00 = u_focal * iz, j02 = u_focal * tx * iz * iz, j12 = u_focal * ty * iz * iz;
  vec3 r0 = vec3(u_V[0][0], u_V[1][0], u_V[2][0]);
  vec3 r1 = vec3(u_V[0][1], u_V[1][1], u_V[2][1]);
  vec3 r2 = vec3(u_V[0][2], u_V[1][2], u_V[2][2]);
  vec3 a = j00 * r0 + j02 * r2, b = j00 * r1 + j12 * r2;
  float c00 = d1.x * s2, c01 = d1.y * s2, c02 = d1.z * s2, c11 = d2.x * s2, c12 = d2.y * s2, c22 = d2.z * s2;
  vec3 u = vec3(c00 * a.x + c01 * a.y + c02 * a.z, c01 * a.x + c11 * a.y + c12 * a.z, c02 * a.x + c12 * a.y + c22 * a.z);
  vec3 w = vec3(c00 * b.x + c01 * b.y + c02 * b.z, c01 * b.x + c11 * b.y + c12 * b.z, c02 * b.x + c12 * b.y + c22 * b.z);
  float A = dot(a, u) + 0.15, Bq = dot(b, u), C = dot(b, w) + 0.15, det = A * C - Bq * Bq;
  if (det <= 0.0) { hide(); return; }
  float ex2 = min(3.0 * sqrt(A), 2048.0), ey2 = min(3.0 * sqrt(C), 2048.0);
  float sx = u_focal * cam.x / -cam.z + 0.5 * u_size.x;
  float sy = u_focal * cam.y / -cam.z + 0.5 * u_size.y;
  if (kind == 1) { sx = floor(sx) + 0.5; sy = floor(sy) + 0.5; }
  if (sx + ex2 < 0.0 || sx - ex2 > u_size.x || sy + ey2 < 0.0 || sy - ey2 > u_size.y) { hide(); return; }

  bool solid = al >= 1.0, wd = solid && (flags & 1) == 0, glass = (flags & 16) != 0;
  v_center = vec2(sx, sy);
  v_conic = vec3(C, -Bq, A) / det;
  v_col = min(col, vec3(1.0));
  v_al = al;
  v_dn = dn;
  v_mode = (solid ? 1 : 0) | (wd ? 2 : 0) | (glass ? 4 : 0);
  // the quad is the ellipse's own box at three deviations (a pixel beyond it would fail the -4.5 test anyway), plus a pixel of slack
  vec2 px = vec2(sx, sy) + a_corner * (vec2(ex2, ey2) + 1.0);
  gl_Position = vec4(px / u_size * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPLAT_FS = `#version 300 es
precision highp float;
precision highp int;

flat in vec2 v_center;
flat in vec3 v_conic;
flat in vec3 v_col;
flat in float v_al;
flat in float v_dn;
flat in int v_mode;

// all three are blended with (ONE, ONE_MINUS_SRC_ALPHA): what is written here is already multiplied by its own alpha
layout(location = 0) out vec4 o_color;   // colour over what is there
layout(location = 1) out vec4 o_depth;   // depth: only solids that write it
layout(location = 2) out vec4 o_glass;   // glass: solids rub it out, glass adds to it

void main() {
  vec2 d = gl_FragCoord.xy - v_center;
  float pw = -0.5 * (v_conic.x * d.x * d.x + v_conic.z * d.y * d.y) - v_conic.y * d.x * d.y;
  if (pw > 0.0 || pw < -4.5) discard;
  float gg = v_al * exp(pw);
  float a = min(0.99, gg);
  if ((v_mode & 1) != 0) a = 0.99 * smoothstep(0.38, 0.62, gg);
  if (a < 0.004) discard;
  o_color = vec4(v_col * a, a);
  if ((v_mode & 2) != 0) {
    o_depth = vec4(v_dn * a, 0.0, 0.0, a);
    o_glass = vec4(0.0, 0.0, 0.0, a);
  } else {
    o_depth = vec4(0.0);
    o_glass = (v_mode & 4) != 0 ? vec4(a * 0.5, 0.0, 0.0, 0.0) : vec4(0.0);
  }
}
`;

/** A triangle that covers the screen. */
export const SCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const RESOLVE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_color;
uniform sampler2D u_depth;
uniform sampler2D u_glass;
uniform sampler2D u_pal;   // row 0: the palette, one texel a colour; row 1: the colour shown for each (regraded or the same)
uniform int u_n;
uniform float u_dith;
uniform float u_bend;      // how far glass bends what is behind it, in art pixels
uniform vec2 u_ao;         // contact shade: strength (0 for none), range as a share of the depth span
uniform float u_edge;      // outline: the step in depth that draws one (0 for none)
uniform vec3 u_line;

out vec4 o_rgb;

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
const ivec2 AOT[8] = ivec2[8](ivec2(2, 0), ivec2(-2, 0), ivec2(0, 2), ivec2(0, -2), ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1));

ivec2 size;
ivec2 at(ivec2 q) { return clamp(q, ivec2(0), size - 1); }
float D(ivec2 q) { return texelFetch(u_depth, at(q), 0).r; }
// (the reference keeps glass from going over 1 as it is added to; a float target cannot, so it is held to 1 as it is read)
float G(ivec2 q) { return min(1.0, texelFetch(u_glass, at(q), 0).r); }

void main() {
  size = textureSize(u_color, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(u_color, p, 0).rgb;

  // glass bends what is behind it, by how its own thickness changes across the picture
  float gx = G(p + ivec2(1, 0)) - G(p - ivec2(1, 0)), gy = G(p + ivec2(0, 1)) - G(p - ivec2(0, 1));
  if (G(p) + abs(gx) + abs(gy) > 0.0)
    c = texelFetch(u_color, at(p + ivec2(int(floor(gx * u_bend + 0.5)), int(floor(gy * u_bend + 0.5)))), 0).rgb;

  // a pixel with nearer things close round it is shaded
  float dc = D(p);
  if (u_ao.x > 0.0) {
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float dd = (dc - D(p + AOT[i])) / u_ao.y;
      if (dd > 0.08 && dd < 3.0) occ += min(1.0, dd);
    }
    c *= 1.0 - u_ao.x * min(1.0, occ / 4.0);
  }

  // an outline where the picture steps back sharply; elsewhere a little ordered noise
  float dm = dc - max(2.0 * dc - D(p - ivec2(1, 0)) - D(p + ivec2(1, 0)), 2.0 * dc - D(p + ivec2(0, 1)) - D(p - ivec2(0, 1)));
  if (u_edge > 0.0 && dc - dm > u_edge) c = u_line;
  else {
    float th = (BAYER[(p.x & 3) + ((p.y & 3) << 2)] + 0.5) / 16.0 - 0.5;
    c = clamp(c + th * u_dith, 0.0, 1.0);
  }

  // the nearest colour of the palette
  float bd = 1e9;
  int bi = 0;
  for (int i = 0; i < 256; i++) {
    if (i >= u_n) break;
    vec3 e = c - texelFetch(u_pal, ivec2(i, 0), 0).rgb;
    float dd = dot(e * e, vec3(0.3, 0.55, 0.15));
    if (dd < bd) { bd = dd; bi = i; }
  }
  o_rgb = vec4(texelFetch(u_pal, ivec2(bi, 1), 0).rgb, 1.0);
}
`;
