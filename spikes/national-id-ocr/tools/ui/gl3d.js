// A small WebGL renderer for the two "real object" heroes: the EGY CASH mark as a solid, bevelled
// white piece, and the National ID Card as a laminated card with print, foil and gloss. No library
// (three.js alone is ~650 KB, over the hero budget, and would need a CDN): about 20 KB, offline.
//
// Lighting is image-based from a procedural photo studio (a softbox overhead, two strip lights, a
// dark floor), with Fresnel reflections, a clear coat, ACES tone mapping and a soft contact shadow
// plus a faded floor reflection. The scene only draws when asked (heroes.js runs one rAF loop).

/* ── Math ─────────────────────────────────────────────────────────────────────────────────── */

const M4 = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye, target, up) {
    const z = norm(sub(eye, target));
    const x = norm(cross(up, z));
    const y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
    ]);
  },
  translate: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
  scale: (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
  rotateX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotateY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rotateZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  chain(...ms) { return ms.reduce((acc, m) => M4.multiply(acc, m)); },
  /** The upper 3x3, for normals (every model matrix here is rotation, translation and uniform scale). */
  normal(m) { return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]); },
};
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/* ── Geometry: a bevelled extrusion of any simple polygon ─────────────────────────────────── */

function signedArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/** Ear clipping. `poly` counter-clockwise; returns index triples. */
function triangulate(poly) {
  const idx = poly.map((_, i) => i);
  const tris = [];
  const isConvex = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-12;
  const inside = (p, a, b, c) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    // Strictly inside only: a vertex on an edge (the traced mark has several) must not block an ear.
    const e = 1e-9;
    return (d1 > e && d2 > e && d3 > e) || (d1 < -e && d2 < -e && d3 < -e);
  };
  let guard = 0;
  while (idx.length > 3 && guard < 10000) {
    guard += 1;
    let clipped = false;
    for (let i = 0; i < idx.length; i += 1) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (!isConvex(a, b, c)) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c))) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate: fan out what is left
  }
  for (let i = 1; i + 1 < idx.length; i += 1) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

/** Drop repeated and collinear points: they make zero-length edges and NaN normals. */
function clean(poly) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

/**
 * Extrude `poly` (2D points) to a solid `depth` thick with a 45° chamfer of `bevel` on both faces.
 * `uv(x, y, face)` gives each cap vertex its texture coordinate; walls get (-1, -1).
 * Returns interleaved Float32Array: position(3) normal(3) uv(2) material(1).
 */
function extrude(polyIn, depth, bevel, material, uv = () => [-1, -1]) {
  let poly = clean(polyIn);
  if (signedArea(poly) < 0) poly = poly.slice().reverse();
  const n = poly.length;
  const edgeNormal = (i) => {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // outward for a counter-clockwise polygon
  };
  const inset = poly.map((p, i) => {
    const n0 = edgeNormal((i + n - 1) % n), n1 = edgeNormal(i);
    let mx = n0[0] + n1[0], my = n0[1] + n1[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const k = Math.min(3, 1 / Math.max(0.2, mx * n1[0] + my * n1[1]));
    return [p[0] - mx * bevel * k, p[1] - my * bevel * k];
  });
  const h = depth / 2;
  const out = [];
  const push = (p, nrm, t) => out.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], t[0], t[1], material);
  const tris = triangulate(poly);
  for (const [a, b, c] of tris) {
    for (const i of [a, b, c]) push([inset[i][0], inset[i][1], h], [0, 0, 1], uv(inset[i][0], inset[i][1], 0));
    for (const i of [a, c, b]) push([inset[i][0], inset[i][1], -h], [0, 0, -1], uv(inset[i][0], inset[i][1], 1));
  }
  const quad = (p0, p1, p2, p3, nrm) => {
    for (const p of [p0, p1, p2, p0, p2, p3]) push(p, nrm, [-1, -1]);
  };
  const s = Math.SQRT1_2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const [ex, ey] = edgeNormal(i);
    const o0 = poly[i], o1 = poly[j], i0 = inset[i], i1 = inset[j];
    const hb = h - bevel;
    // front chamfer, wall, back chamfer
    quad([i0[0], i0[1], h], [o0[0], o0[1], hb], [o1[0], o1[1], hb], [i1[0], i1[1], h], [ex * s, ey * s, s]);
    quad([o0[0], o0[1], hb], [o0[0], o0[1], -hb], [o1[0], o1[1], -hb], [o1[0], o1[1], hb], [ex, ey, 0]);
    quad([o0[0], o0[1], -hb], [i0[0], i0[1], -h], [i1[0], i1[1], -h], [o1[0], o1[1], -hb], [ex * s, ey * s, -s]);
  }
  return out;
}

function roundedRect(w, h, r, segments = 10) {
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i += 1) {
      const a = ((start + (90 * i) / segments) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/* ── Shaders ──────────────────────────────────────────────────────────────────────────────── */

const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute float aMat;
uniform mat4 uModel; uniform mat4 uViewProj; uniform mat3 uNormal;
varying vec3 vWorld; varying vec3 vNor; varying vec2 vUv; varying float vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz; vNor = uNormal * aNor; vUv = aUv; vMat = aMat;
  gl_Position = uViewProj * w;
}`;

const FS = `
precision highp float;
varying vec3 vWorld; varying vec3 vNor; varying vec2 vUv; varying float vMat;
uniform vec3 uEye; uniform vec3 uAccent; uniform float uAlpha; uniform float uFloorY; uniform float uFade;
uniform float uMute;          // 0 normal, 1 invalid: colour drains, a red cast comes in
uniform float uStamp;         // 0..1: the certificate's ink stamp pressed in (mask channel B)
uniform float uTime;
uniform sampler2D uFront; uniform sampler2D uBack; uniform sampler2D uMask; uniform float uTextured;
// Materials (by vMat): 0 white satin, 1 white gloss, 2 card laminate, 3 card core edge
const float PI = 3.14159265;

// The studio, seen in direction d, blurred by roughness r: a large softbox above, two tall strip
// lights at the sides (one tinted with the theme's accent), a dim warm bounce from the floor.
vec3 studio(vec3 d, float r) {
  float w = 0.06 + r * 0.55;
  vec3 c = mix(vec3(0.018, 0.018, 0.024), vec3(0.06, 0.06, 0.075), smoothstep(-0.2, 0.6, d.y));
  float top = smoothstep(0.62 - w, 0.62 + w * 0.5, d.y) * smoothstep(0.75 + w, 0.35, abs(d.x));
  c += vec3(3.2) * top;
  float az = atan(d.x, d.z);
  float stripL = smoothstep(w * 1.2, 0.0, abs(az + 1.15) - 0.09) * smoothstep(0.85, 0.1 - w, abs(d.y - 0.12));
  float stripR = smoothstep(w * 1.2, 0.0, abs(az - 1.3) - 0.07) * smoothstep(0.85, 0.1 - w, abs(d.y - 0.1));
  c += vec3(2.1) * stripL + uAccent * 2.6 * stripR;
  // A big softbox behind the camera, up and to the left: what the faces turned to the viewer
  // reflect, so a highlight sweeps across them as the object turns.
  float front = smoothstep(w * 1.5, 0.0, abs(az + 0.5) - 0.24) * smoothstep(0.32 + w, 0.0, abs(d.y - 0.38));
  c += vec3(1.7) * front;
  float back = smoothstep(w * 2.0, 0.0, abs(az - 3.1) - 0.25) * smoothstep(0.9, 0.0, abs(d.y - 0.15));
  c += vec3(0.5) * back;
  c += vec3(0.09, 0.075, 0.06) * smoothstep(0.0, -0.6, d.y);
  return c;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  vec3 R = reflect(-V, N);
  float ndv = max(dot(N, V), 0.0);

  vec3 base = vec3(0.86, 0.865, 0.88);
  float rough = 0.24;
  float coat = 0.55;
  float holo = 0.0;
  if (vMat > 0.5 && vMat < 1.5) { base = vec3(0.97); rough = 0.1; coat = 0.9; }
  if (vMat > 1.5 && vMat < 2.5) {
    rough = 0.38; coat = 1.0;
    if (uTextured > 0.5 && vUv.x >= 0.0) {
      bool back = vUv.y > 1.5;
      vec2 uv = vec2(vUv.x, back ? vUv.y - 2.0 : vUv.y);
      base = back ? texture2D(uBack, uv).rgb : texture2D(uFront, uv).rgb;
      base = pow(base, vec3(2.2));
      vec4 m = texture2D(uMask, uv);
      holo = back ? 0.0 : m.r;
      rough = mix(rough, 0.18, m.g);
      // Stamp ink soaks into the print (multiply).
      float ink = back ? 0.0 : m.b * uStamp;
      base = mix(base, base * vec3(0.78, 0.10, 0.12), ink * 0.9);
    } else {
      base = vec3(0.86, 0.85, 0.82);
    }
  }
  if (vMat > 2.5) { base = vec3(0.92, 0.91, 0.88); rough = 0.5; coat = 0.4; }

  // Diffuse: the studio seen through a very rough lobe, a warm key (a point light, so a flat face
  // still shades across), a cool fill, and an accent rim from behind.
  vec3 keyP = vec3(-3.0, 4.0, 4.5);
  vec3 Lk = normalize(keyP - vWorld);
  float dk = length(keyP - vWorld);
  float key = max(dot(N, Lk), 0.0) * 19.0 / (dk * dk);
  vec3 Lf = normalize(vec3(4.0, 0.5, 3.0) - vWorld);
  float fill = max(dot(N, Lf), 0.0) * 0.22;
  vec3 Lr = normalize(vec3(2.5, 2.0, -4.0) - vWorld);
  float rim = pow(1.0 - ndv, 2.5) * max(dot(N, Lr), 0.0);
  vec3 irr = studio(N, 1.0) * 0.32 + vec3(1.0, 0.97, 0.92) * key + vec3(0.85, 0.9, 1.0) * fill + 0.035;
  vec3 col = base * irr;
  // Soft occlusion: the faces turned down and away from the light sit in shade.
  col *= mix(0.72, 1.0, smoothstep(-0.9, 0.6, N.y + 0.35));

  // Specular: highlights from the key (sharp on gloss, wide on satin), dielectric Fresnel
  // reflections of the studio, and a mirror-sharp clear coat.
  vec3 H = normalize(Lk + V);
  float shininess = mix(900.0, 40.0, rough);
  col += vec3(1.0, 0.98, 0.94) * pow(max(dot(N, H), 0.0), shininess) * (shininess / 40.0) * 0.09 * key;
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  col += studio(R, rough) * mix(0.06, 1.0, F) * (1.0 - rough * 0.5);
  col += studio(R, 0.03) * F * coat;
  col += uAccent * rim * 1.6;

  // Holographic foil: thin-film colours that shift with the viewing angle.
  if (holo > 0.01) {
    float phase = ndv * 3.2 + (vUv.x + vUv.y) * 4.0 + uTime * 0.05;
    vec3 film = 0.5 + 0.5 * cos(2.0 * PI * (phase + vec3(0.0, 0.33, 0.67)));
    col = mix(col, col * 0.6 + film * (0.55 + 0.9 * studio(R, 0.25).g * 0.3), holo * 0.75);
  }

  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(grey) * vec3(1.15, 0.78, 0.76), uMute * 0.8);
  col = aces(col * 0.92);
  col = pow(col, vec3(1.0 / 2.2));

  // The floor reflection fades with the distance under the floor.
  float a = uAlpha * exp(-max(0.0, uFloorY - vWorld.y) * uFade);
  gl_FragColor = vec4(col * a, a);
}`;

// The floor: a soft contact shadow under the object (a blurred ellipse, darker near the middle).
const VS_FLOOR = `
attribute vec2 aPos; uniform mat4 uViewProj; uniform vec3 uCenter; uniform vec2 uSize; varying vec2 vP;
void main() { vP = aPos; gl_Position = uViewProj * vec4(uCenter + vec3(aPos.x * uSize.x, 0.0, aPos.y * uSize.y), 1.0); }`;
const FS_FLOOR = `
precision mediump float; varying vec2 vP; uniform float uStrength;
void main() {
  float d = length(vP);
  float a = (smoothstep(1.0, 0.0, d) * 0.55 + smoothstep(0.45, 0.0, d) * 0.45) * uStrength;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

function compile(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  const loc = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const name = gl.getActiveUniform(program, i).name;
    loc[name] = gl.getUniformLocation(program, name);
  }
  const attrs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attrs; i += 1) {
    const name = gl.getActiveAttrib(program, i).name;
    loc[name] = gl.getAttribLocation(program, name);
  }
  return { program, loc };
}

/* ── Card artwork (drawn once, offline, to canvases) ──────────────────────────────────────── */
// A SPECIMEN in the card's style, not a real card: no emblem, no real person, an impossible number.

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arabicDigits = (s) => s.replace(/\d/g, (d) => AR_DIGITS[d]);

function guilloche(ctx, cx, cy, R, amp, lobes, rings, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let k = 0; k < rings; k += 1) {
    ctx.beginPath();
    for (let i = 0; i <= 720; i += 1) {
      const t = (i / 720) * Math.PI * 2;
      const r = R + amp * Math.sin(lobes * t + (k * Math.PI * 2) / rings) + (amp / 3) * Math.cos((lobes + 3) * t);
      const x = cx + r * Math.cos(t), y = cy + r * Math.sin(t) * 0.92;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function waves(ctx, w, h, color, count, step) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let k = 0; k < count; k += 1) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const y = k * step + Math.sin(x / 38 + k * 0.6) * 7 + Math.sin(x / 13 + k) * 1.5;
      if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function silhouette(ctx, x, y, w, h) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#c9d3dc"); g.addColorStop(1, "#9fb0bf");
  ctx.fillStyle = g;
  roundRectPath(ctx, x, y, w, h, 10); ctx.fill();
  ctx.clip();
  ctx.fillStyle = "#6f8193";
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.4, w * 0.22, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 1.02, w * 0.48, h * 0.38, 0, Math.PI, 0); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(60,50,30,.35)"; ctx.lineWidth = 2;
  roundRectPath(ctx, x, y, w, h, 10); ctx.stroke();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function pyramids(ctx, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
  g.addColorStop(0, "#b8782a"); g.addColorStop(1, "#e0a85a");
  ctx.fillStyle = g;
  for (const [cx, base, peak] of [[w * 0.42, w * 0.34, h * 0.36], [w * 0.68, w * 0.26, h * 0.48], [w * 0.86, w * 0.16, h * 0.6]]) {
    ctx.beginPath(); ctx.moveTo(cx - base / 2, h * 0.86); ctx.lineTo(cx, peak); ctx.lineTo(cx + base / 2, h * 0.86); ctx.fill();
  }
  ctx.restore();
}

function cardFront(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#f8ecd2"); g.addColorStop(0.45, "#f3e2bf"); g.addColorStop(1, "#ead6ae");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  waves(x, W, H, "rgba(176,128,52,.13)", 70, H / 64);
  pyramids(x, W, H);
  guilloche(x, W * 0.62, H * 0.56, H * 0.3, H * 0.05, 14, 22, "rgba(150,108,40,.18)", 1);
  guilloche(x, W * 0.62, H * 0.56, H * 0.17, H * 0.03, 9, 14, "rgba(30,110,120,.14)", 1);
  // Header band: the flag's colours as plain stripes (no eagle), and the card's titles.
  const fx = W - 150, fy = 34;
  for (const [i, colr] of ["#ce1126", "#ffffff", "#111111"].entries()) { x.fillStyle = colr; x.fillRect(fx, fy + i * 22, 110, 22); }
  x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1.5; x.strokeRect(fx, fy, 110, 66);
  x.fillStyle = "#3b2a14"; x.textAlign = "right"; x.direction = "rtl";
  x.font = "700 40px 'Segoe UI', Tahoma, sans-serif"; x.fillText("جمهورية مصر العربية", fx - 24, 70);
  x.font = "600 30px 'Segoe UI', Tahoma, sans-serif"; x.fillStyle = "#6b4c1e"; x.fillText("بطاقة تحقيق الشخصية", fx - 24, 112);
  silhouette(x, 46, 150, 230, 290);
  // Specimen fields: generic words, not a person.
  x.fillStyle = "#1d160c";
  x.font = "700 46px 'Segoe UI', Tahoma, sans-serif"; x.fillText("الاسم الأول", W - 60, 220);
  x.font = "600 40px 'Segoe UI', Tahoma, sans-serif"; x.fillText("اسم الأب والعائلة", W - 60, 280);
  x.font = "500 32px 'Segoe UI', Tahoma, sans-serif"; x.fillStyle = "#3a2d1a";
  x.fillText("العنوان: الشارع والمنطقة", W - 60, 340); x.fillText("المحافظة", W - 60, 386);
  // The number line, in the card's Eastern Arabic digits. It starts with 1, a century digit no
  // real number has, so it can never be a person's number.
  x.font = "700 58px Arial, Tahoma, sans-serif"; x.fillStyle = "#120d06"; x.direction = "ltr"; x.textAlign = "center";
  // U+202D … U+202C: keep the digit groups left to right, as printed (bidi would reverse them).
  x.fillText(`‭${arabicDigits("1 2345 678 9012 34").replace(/ /g, "  ")}‬`, W * 0.6, H - 70);
  // A diagonal SPECIMEN mark: this is artwork, not an identity document.
  x.save(); x.translate(W * 0.55, H * 0.55); x.rotate(-0.32);
  x.font = "800 64px 'Segoe UI', sans-serif"; x.fillStyle = "rgba(200,16,46,.12)"; x.fillText("SPECIMEN · عينة", 0, 0);
  x.restore();
  // Laminate border.
  x.strokeStyle = "rgba(150,108,40,.35)"; x.lineWidth = 4; roundRectPath(x, 14, 14, W - 28, H - 28, 30); x.stroke();
  return c;
}

function cardBack(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#eef1e6"); g.addColorStop(1, "#dfe6d6");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  waves(x, W, H, "rgba(60,110,90,.12)", 70, H / 64);
  guilloche(x, W * 0.3, H * 0.4, H * 0.24, H * 0.04, 12, 18, "rgba(60,110,90,.18)", 1);
  x.fillStyle = "#1f2a20"; x.textAlign = "right"; x.direction = "rtl";
  x.font = "600 34px Tahoma, Arial, sans-serif";
  const rows = ["المهنة: ــــــــ", "النوع: ــــ        الديانة: ــــ", "الحالة الاجتماعية: ــــ", "البطاقة سارية حتى: " + arabicDigits("2030/01/01")];
  rows.forEach((row, i) => x.fillText(row, W - 60, 92 + i * 62));
  // A barcode band (random bars from a fixed seed: decoration, encodes nothing).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = "#fff"; x.fillRect(40, H - 190, W - 80, 140);
  x.fillStyle = "#111";
  for (let px = 60; px < W - 60;) { const bw = 2 + Math.floor(rnd() * 6); if (rnd() > 0.45) x.fillRect(px, H - 175, bw, 110); px += bw + 1 + Math.floor(rnd() * 3); }
  x.save(); x.translate(W * 0.5, H * 0.45); x.rotate(-0.32); x.textAlign = "center";
  x.font = "800 64px 'Segoe UI', sans-serif"; x.fillStyle = "rgba(200,16,46,.12)"; x.fillText("SPECIMEN · عينة", 0, 0);
  x.restore();
  return c;
}

/** R: holographic foil; G: extra gloss. */
function cardMask(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = "lighter";
  // A round foil seal over the photo's corner, and a thin foil ribbon under the titles.
  const r = x.createRadialGradient(270, 420, 10, 270, 420, 90);
  r.addColorStop(0, "rgb(255,0,0)"); r.addColorStop(0.8, "rgb(230,0,0)"); r.addColorStop(1, "rgb(0,0,0)");
  x.fillStyle = r; x.beginPath(); x.arc(270, 420, 90, 0, Math.PI * 2); x.fill();
  x.fillStyle = "rgb(150,0,0)"; x.fillRect(330, 128, W - 520, 10);
  x.fillStyle = "rgb(0,120,0)"; x.fillRect(0, 0, W, H);
  return c;
}

/* ── Models ───────────────────────────────────────────────────────────────────────────────── */

// The EGY CASH mark, traced from profiles/egycash-logo.png (viewBox 0 0 132 186, y down).
const MARK = [
  { tone: 0, d: [[44, 102], [33, 111], [22, 132], [22, 140], [51, 183], [55, 185], [73, 150], [49, 119], [46, 110], [47, 102]] },
  { tone: 0, d: [[77, 1], [59, 37], [83, 68], [86, 77], [85, 85], [88, 85], [99, 76], [110, 55], [110, 47], [79, 1]] },
  { tone: 1, d: [[47, 110], [50, 119], [64, 138], [113, 138], [131, 102], [48, 102]] },
  { tone: 1, d: [[1, 83], [1, 85], [84, 85], [85, 77], [82, 68], [68, 49], [19, 49]] },
];

function logoModel() {
  const data = [];
  const s = 1 / 93;
  MARK.forEach((part, i) => {
    const poly = part.d.map(([px, py]) => [(px - 66) * s, (93 - py) * s]);
    // Stagger the two tones in depth a touch, as the printed mark overlaps its ribbons.
    const verts = extrude(poly, 0.3, 0.035, part.tone);
    const dz = part.tone ? 0.0 : 0.012 * (i % 2 ? 1 : -1);
    for (let k = 0; k < verts.length; k += 9) verts[k + 2] += dz;
    data.push(...verts);
  });
  return { data: new Float32Array(data), height: 2, floor: -1.28 };
}

/** The certificate: a laminated A5 form, in its own style. A SPECIMEN: no emblem, no issuing
 *  body's name, no insignia, no real person; generic form labels and blank values. */
function certificateFront(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#e6f1ee"); g.addColorStop(0.5, "#dcebe7"); g.addColorStop(1, "#d2e3df");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  waves(x, W, H, "rgba(40,110,110,.10)", 90, H / 86);
  guilloche(x, W * 0.5, H * 0.52, H * 0.34, H * 0.05, 16, 26, "rgba(40,110,110,.12)", 1);
  // Frame lines, as a printed form has.
  x.strokeStyle = "rgba(30,70,70,.45)"; x.lineWidth = 3; x.strokeRect(26, 26, W - 52, H - 52);
  x.lineWidth = 1; x.strokeRect(36, 36, W - 72, H - 72);
  // Title and photo.
  x.fillStyle = "#16302e"; x.textAlign = "center"; x.direction = "rtl";
  x.font = "700 40px Tahoma, 'Segoe UI', sans-serif"; x.fillText("شهادة إعفاء", W * 0.5, 104);
  x.font = "500 22px Tahoma, 'Segoe UI', sans-serif"; x.fillStyle = "#2e4a47";
  x.fillText("من الخدمة العسكرية · نموذج", W * 0.5, 138);
  silhouette(x, W * 0.5 - 50, 156, 100, 118);
  // The table: labels on a header row, blank values under them.
  const top = 330, rowH = 54, left = 70, right = W - 70;
  const cols = [right, right - 250, right - 500, right - 600, right - 760, left];
  const labels = ["رقم البطاقة", "الرقم القومي", "كود", "رقم القرار", "تاريخ القرار"];
  x.strokeStyle = "rgba(30,70,70,.55)"; x.lineWidth = 2;
  x.strokeRect(left, top, right - left, rowH * 2);
  x.beginPath(); x.moveTo(left, top + rowH); x.lineTo(right, top + rowH); x.stroke();
  for (let i = 1; i < cols.length - 1; i += 1) { x.beginPath(); x.moveTo(cols[i], top); x.lineTo(cols[i], top + rowH * 2); x.stroke(); }
  x.font = "600 21px Tahoma, 'Segoe UI', sans-serif"; x.fillStyle = "#1d3a37";
  labels.forEach((label, i) => x.fillText(label, (cols[i] + cols[i + 1]) / 2, top + 34));
  x.font = "600 24px Tahoma, sans-serif"; x.fillStyle = "#33504c";
  labels.forEach((_, i) => x.fillText("ــــــ", (cols[i] + cols[i + 1]) / 2, top + rowH + 36));
  // The name row above the table, and the decision below it.
  x.textAlign = "right"; x.font = "600 24px Tahoma, 'Segoe UI', sans-serif"; x.fillStyle = "#1d3a37";
  x.fillText("الاسم واللقب: ــــــــــــــــ", right, top - 22);
  x.textAlign = "left"; x.fillText("تاريخ الميلاد: ــــ/ــ/ــ", left, top - 22);
  x.textAlign = "right"; x.font = "500 22px Tahoma, 'Segoe UI', sans-serif";
  x.fillText("القرار: ــــــــــــــــــــــــــــــ", right, top + rowH * 2 + 48);
  // Signatures: loose ink strokes, in two places.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.strokeStyle = "rgba(25,45,120,.75)"; x.lineWidth = 2.4;
  for (const sx of [W * 0.40, W * 0.66]) {
    x.beginPath(); x.moveTo(sx, H - 96);
    for (let i = 0; i < 6; i += 1) {
      x.bezierCurveTo(sx + 26 * i + rnd() * 26, H - 122 + rnd() * 40, sx + 26 * i + 18, H - 80 - rnd() * 40, sx + 26 * (i + 1), H - 98 + rnd() * 12);
    }
    x.stroke();
  }
  x.save(); x.translate(W * 0.5, H * 0.62); x.rotate(-0.22); x.textAlign = "center";
  x.font = "800 70px 'Segoe UI', sans-serif"; x.fillStyle = "rgba(160,20,30,.10)"; x.fillText("SPECIMEN · عينة", 0, 0);
  x.restore();
  return c;
}

function certificateBack(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#eef4f1"); g.addColorStop(1, "#e2ece8");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  waves(x, W, H, "rgba(40,110,110,.07)", 90, H / 86);
  return c;
}

/** R: no foil; G: the laminate's gloss; B: where the stamp's ink lands (rings, dashes, a word). */
function certificateMask(W, H) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "rgb(0,150,0)"; x.fillRect(0, 0, W, H);
  const cx = W * 0.2, cy = H * 0.76, r = 92;
  x.strokeStyle = "rgb(0,150,255)";
  for (const [radius, width, dash] of [[r, 7, []], [r - 14, 3, []], [r - 26, 3, [6, 6]], [r * 0.42, 5, []]]) {
    x.lineWidth = width; x.setLineDash(dash); x.beginPath(); x.arc(cx, cy, radius, 0, Math.PI * 2); x.stroke();
  }
  x.setLineDash([]);
  x.fillStyle = "rgb(0,150,255)"; x.textAlign = "center"; x.font = "800 26px Tahoma, sans-serif";
  x.fillText("عينة", cx, cy + 9);
  // Small gaps in the ink, so the stamp reads as pressed ink and not as a drawing.
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = "rgb(0,150,0)";
  for (let i = 0; i < 260; i += 1) { const a = rnd() * Math.PI * 2, d = rnd() * r; x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); }
  return c;
}

function certificateModel() {
  const W = 3.7, H = W / 1.45;
  const uv = (px, py, face) => {
    const u = px / W + 0.5, v = 0.5 - py / H;
    return face ? [1 - u, v + 2] : [u, v];
  };
  const sheet = extrude(roundedRect(W, H, 0.06, 6), 0.035, 0.01, 2, uv);
  for (let k = 0; k < sheet.length; k += 9) if (sheet[k + 6] < 0) sheet[k + 8] = 3;
  return { data: new Float32Array(sheet), height: H, floor: -1.6 };
}

function cardModel() {
  const W = 3.4, H = W / 1.586;
  const uv = (px, py, face) => {
    const u = px / W + 0.5, v = 0.5 - py / H;
    return face ? [1 - u, v + 2] : [u, v];
  };
  const laminate = extrude(roundedRect(W, H, 0.16), 0.06, 0.018, 2, uv);
  // Recolour the walls (uv -1) as the card's white core.
  for (let k = 0; k < laminate.length; k += 9) if (laminate[k + 6] < 0) laminate[k + 8] = 3;
  return { data: new Float32Array(laminate), height: H, floor: -1.55 };
}

/* ── Renderer ─────────────────────────────────────────────────────────────────────────────── */

function texture(gl, source) {
  // WebGL 1 mipmaps need power-of-two sizes: stretch the artwork onto one (the UVs are 0..1).
  const pot = (n) => 2 ** Math.round(Math.log2(n));
  let canvas = source;
  if (pot(source.width) !== source.width || pot(source.height) !== source.height) {
    canvas = document.createElement("canvas");
    canvas.width = Math.min(2048, pot(source.width));
    canvas.height = Math.min(2048, pot(source.height));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return tex;
}

/**
 * A live 3D object in `canvas`. kind: "logo" | "card". Returns { draw(pose), resize(), destroy() } or
 * null without WebGL. `pose`: { rx, ry, rz, y, mute, time } (radians, units, 0..1, seconds).
 */
export function createObjectScene(canvas, kind, accent = [0.45, 0.45, 1.0]) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
  if (!gl) return null;
  let main, floor;
  try {
    main = compile(gl, VS, FS);
    floor = compile(gl, VS_FLOOR, FS_FLOOR);
  } catch (error) {
    console.warn("3D hero unavailable:", error.message);
    return null;
  }
  const flat = kind === "card" || kind === "certificate"; // a printed, textured object
  const model = kind === "card" ? cardModel() : kind === "certificate" ? certificateModel() : logoModel();
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, model.data, gl.STATIC_DRAW);
  const count = model.data.length / 9;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

  let textures = null;
  if (kind === "certificate") {
    const W = 1024, H = 706;
    textures = [texture(gl, certificateFront(W, H)), texture(gl, certificateBack(W, H)), texture(gl, certificateMask(W, H))];
  } else if (kind === "card") {
    const W = 1024, H = 646;
    textures = [texture(gl, cardFront(W, H)), texture(gl, cardBack(W, H)), texture(gl, cardMask(W, H))];
  }

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };

  const bindMain = () => {
    gl.useProgram(main.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = 36;
    const attr = (name, size, offset) => {
      const at = main.loc[name];
      if (at < 0 || at === undefined) return;
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
    };
    attr("aPos", 3, 0); attr("aNor", 3, 12); attr("aUv", 2, 24); attr("aMat", 1, 32);
  };

  function draw(pose) {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = canvas.width / canvas.height;
    // Keep the object filling the frame whatever the aspect.
    const fit = kind === "certificate" ? 4.0 : kind === "card" ? 3.75 : 2.3;
    const dist = Math.max(fit / Math.tan(0.26) / 2, (fit * 1.45) / Math.tan(0.26) / 2 / aspect) * 1.0;
    const eye = [0, flat ? 0.35 : 0.45, dist];
    const view = M4.lookAt(eye, [0, flat ? -0.1 : -0.05, 0], [0, 1, 0]);
    const viewProj = M4.multiply(M4.perspective(0.52, aspect, 0.1, 100), view);
    const modelM = M4.chain(M4.translate(0, pose.y || 0, 0), M4.rotateY(pose.ry || 0), M4.rotateX(pose.rx || 0), M4.rotateZ(pose.rz || 0));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    // 1. Contact shadow on the floor (no depth).
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(floor.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    for (let i = 0; i < 8; i += 1) gl.disableVertexAttribArray(i);
    gl.enableVertexAttribArray(floor.loc.aPos);
    gl.vertexAttribPointer(floor.loc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(floor.loc.uViewProj, false, viewProj);
    gl.uniform3f(floor.loc.uCenter, 0, model.floor, 0);
    const lift = Math.max(0, (pose.y || 0)) * 0.6;
    gl.uniform2f(floor.loc.uSize, flat ? 2.4 : 1.25 + lift, flat ? 0.75 : 0.55);
    gl.uniform1f(floor.loc.uStrength, 0.75 - lift);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. The object, then its reflection in the floor (mirrored through the floor plane).
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    bindMain();
    for (let i = 0; i < 8; i += 1) if (![main.loc.aPos, main.loc.aNor, main.loc.aUv, main.loc.aMat].includes(i)) gl.disableVertexAttribArray(i);
    gl.uniformMatrix4fv(main.loc.uViewProj, false, viewProj);
    gl.uniform3f(main.loc.uEye, eye[0], eye[1], eye[2]);
    gl.uniform3f(main.loc.uAccent, accent[0], accent[1], accent[2]);
    gl.uniform1f(main.loc.uMute, pose.mute || 0);
    gl.uniform1f(main.loc.uTime, pose.time || 0);
    gl.uniform1f(main.loc.uTextured, textures ? 1 : 0);
    gl.uniform1f(main.loc.uStamp, pose.stamp || 0);
    if (textures) {
      textures.forEach((tex, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex); });
      gl.uniform1i(main.loc.uFront, 0); gl.uniform1i(main.loc.uBack, 1); gl.uniform1i(main.loc.uMask, 2);
    }
    const drawWith = (m, alpha, fade) => {
      gl.uniformMatrix4fv(main.loc.uModel, false, m);
      gl.uniformMatrix3fv(main.loc.uNormal, false, M4.normal(m));
      gl.uniform1f(main.loc.uAlpha, alpha);
      gl.uniform1f(main.loc.uFloorY, model.floor);
      gl.uniform1f(main.loc.uFade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };
    const mirror = M4.chain(M4.translate(0, 2 * model.floor, 0), M4.scale(1, -1, 1));
    gl.depthMask(false);
    // The floor reflection suits the turning mark; under a tilted card it reads as a stray sliver.
    if (kind === "logo") drawWith(M4.multiply(mirror, modelM), 0.16, 1.6);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    drawWith(modelM, 1, 0);
  }

  return {
    draw,
    resize,
    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** For tests: the geometry builders, without a GPU. */
export const _geometry = { extrude, triangulate, roundedRect, logoModel, cardModel, certificateModel, signedArea };
