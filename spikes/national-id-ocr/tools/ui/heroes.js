// The heroes: the EGY CASH mark, the National ID Card and the Army certificate as 3D objects (WebGL,
// gl3d.js). One requestAnimationFrame loop drives them all and stops
// whenever no hero is on screen or the tab is hidden. Under prefers-reduced-motion the 3D heroes
// draw one still frame and nothing loops. Without WebGL the CSS scenes below take their place.

import { createObjectScene } from "./gl3d.js";

const MARK = {
  d: [
    "M44,102 L33,111 L22,132 L22,140 L51,183 L55,185 L73,150 L49,119 L46,110 L47,102Z",
    "M77,1 L59,37 L83,68 L86,77 L85,85 L88,85 L99,76 L110,55 L110,47 L79,1Z",
  ],
  l: [
    "M47,110 L50,119 L64,138 L113,138 L131,102 L48,102Z",
    "M1,83 L1,85 L84,85 L85,77 L82,68 L68,49 L19,49Z",
  ],
};
const SVG_NS = "http://www.w3.org/2000/svg";
const ACCENT = { egyid: [0.42, 0.41, 1.0], nid: [1.0, 0.78, 0.3], army: [0.62, 0.8, 0.62] };
const TAU = Math.PI * 2;

function markSvg(className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 132 186");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  for (const [tone, paths] of Object.entries(MARK)) {
    for (const d of paths) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", tone);
      svg.appendChild(path);
    }
  }
  return svg;
}

function el(tag, className, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) node.appendChild(child);
  return node;
}

// CSS scenes, used only when WebGL is not available.
const BUILD_CSS = {
  egyid(scene) {
    scene.append(el("div", "halo"), el("div", "floor"), el("div", "ring"), el("div", "ring"));
    const logo = el("div", "logo3d");
    for (let i = 10; i >= 1; i -= 1) {
      const slice = markSvg("slice");
      slice.style.setProperty("--z", `${-i * 1.4}px`);
      logo.appendChild(slice);
    }
    const face = markSvg("face");
    face.style.setProperty("--z", "0px");
    logo.appendChild(face);
    const reflection = el("div", "reflection", [markSvg("")]);
    scene.append(logo, reflection, el("div", "scanline"));
    return { logo, reflection };
  },
  nid(scene) {
    const face = el("div", "face", [
      el("div", "flag", [el("i"), el("i"), el("i")]),
      el("div", "chip"), el("div", "photo"),
      el("div", "rows", [el("i"), el("i"), el("i")]),
      el("div", "digits"), el("div", "sweep"), el("div", "frame"), el("div", "scanline"),
    ]);
    const card = el("div", "card3d", [face]);
    scene.append(el("div", "pattern"), card);
    return { card };
  },
  army(scene) {
    const seal = document.createElementNS(SVG_NS, "svg");
    seal.setAttribute("viewBox", "0 0 100 100");
    seal.setAttribute("class", "seal");
    seal.setAttribute("aria-hidden", "true");
    for (const [r, w, dash] of [[46, 3, ""], [39, 1.2, ""], [33, 1.2, "2 3"], [20, 2, ""]]) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", "50"); circle.setAttribute("cy", "50"); circle.setAttribute("r", String(r));
      circle.setAttribute("stroke-width", String(w));
      if (dash) circle.setAttribute("stroke-dasharray", dash);
      seal.appendChild(circle);
    }
    const sheet = el("div", "sheet", [
      el("div", "title"), el("div", "lines", Array.from({ length: 7 }, () => el("i"))), el("div", "scanline"),
    ]);
    sheet.appendChild(seal);
    scene.append(el("div", "halo"), sheet);
    return { sheet };
  },
};

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const heroes = new Set();
let frame = 0;
let last = 0;

// Logo turn speeds, radians per second, by state. 'match' settles; 'invalid' stops.
const SPIN = { idle: 0.5, reading: 2.6, unreadable: 0.5, failed: 0.5 };

function stateOf(hero) {
  return hero.root.closest("[data-state]")?.dataset.state || "idle";
}

const ease = (from, to, rate, dt) => from + (to - from) * Math.min(1, dt * rate);
/** The nearest angle ahead of `a` that faces the viewer (a multiple of a full turn). */
const faceAhead = (a) => Math.ceil((a - 0.15) / TAU) * TAU;

function poseLogo(hero, state, t, dt) {
  const p = hero.pose;
  if (hero.drag) {
    p.ry += hero.drag.v * dt;
  } else if (state === "match") {
    p.ry = ease(p.ry, faceAhead(p.ry), 4, dt);
  } else if (state !== "invalid") {
    hero.spin = ease(hero.spin, SPIN[state] ?? 0.5, 2.5, dt);
    p.ry += (hero.spin + hero.fling) * dt;
  }
  hero.fling = ease(hero.fling, 0, 1.5, dt);
  p.rx = ease(p.rx, state === "invalid" ? 0.2 : -0.05 + Math.sin(t * 0.6) * 0.05, 3, dt);
  p.y = state === "invalid" ? ease(p.y, -0.12, 3, dt) : Math.sin(t * 1.2 + hero.phase) * 0.07;
  p.mute = ease(p.mute, state === "invalid" ? 1 : 0, 4, dt);
}

function poseCard(hero, state, t, dt) {
  const p = hero.pose;
  const aim = hero.pointer || { x: Math.sin(t * 0.45) * 0.4, y: Math.cos(t * 0.37) * 0.3 };
  if (state === "reading") {
    // Reading both sides: the card turns over and back, steadily.
    hero.flip += dt * 2.2;
    p.ry = hero.flip;
  } else {
    const base = state === "match" ? faceAhead(hero.flip) : Math.round(hero.flip / TAU) * TAU;
    hero.flip = ease(hero.flip, base, 3.5, dt);
    const tiltY = state === "invalid" ? 0.25 : aim.x * 0.65;
    p.ry = hero.flip + tiltY;
  }
  p.rx = ease(p.rx, state === "invalid" ? 0.45 : -aim.y * 0.45 + 0.08, 5, dt);
  p.rz = ease(p.rz, state === "invalid" ? -0.06 : aim.x * -0.06, 4, dt);
  p.y = state === "invalid" ? ease(p.y, -0.15, 3, dt) : Math.sin(t * 1.1 + hero.phase) * 0.06 + 0.05;
  p.mute = ease(p.mute, state === "invalid" ? 1 : 0, 4, dt);
}

/** The certificate: it tilts toward the pointer; while reading it sways under the scan; on a match
 *  the ink stamp presses in (a quick dip toward the table, then the ink); invalid, it greys and sinks. */
function poseCertificate(hero, state, t, dt) {
  const p = hero.pose;
  const aim = hero.pointer || { x: Math.sin(t * 0.4) * 0.35, y: Math.cos(t * 0.33) * 0.25 };
  const reading = state === "reading";
  p.ry = ease(p.ry, state === "invalid" ? 0.2 : reading ? Math.sin(t * 1.6) * 0.28 : aim.x * 0.5, 4, dt);
  p.rx = ease(p.rx, state === "invalid" ? 0.5 : -aim.y * 0.35 + 0.12, 5, dt);
  p.rz = ease(p.rz, -0.04 + (reading ? Math.sin(t * 1.1) * 0.02 : 0), 3, dt);
  const stamped = state === "match";
  if (stamped && p.stamp < 0.02) hero.pressAt = t; // the moment of the press
  p.stamp = ease(p.stamp, stamped ? 1 : 0, stamped ? 7 : 3, dt);
  const press = hero.pressAt != null && t - hero.pressAt < 0.45 ? Math.sin(((t - hero.pressAt) / 0.45) * Math.PI) * -0.08 : 0;
  p.y = state === "invalid" ? ease(p.y, -0.15, 3, dt) : Math.sin(t * 1.0 + hero.phase) * 0.05 + 0.04 + press;
  p.mute = ease(p.mute, state === "invalid" ? 1 : 0, 4, dt);
}

function step(now) {
  frame = 0;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
  last = now;
  let running = false;
  for (const hero of heroes) {
    if (!hero.visible || document.hidden) continue;
    running = true;
    const state = stateOf(hero);
    const t = now / 1000;
    if (hero.gl) {
      if (hero.kind === "logo") poseLogo(hero, state, t, dt);
      else if (hero.kind === "certificate") poseCertificate(hero, state, t, dt);
      else poseCard(hero, state, t, dt);
      hero.pose.time = t;
      hero.gl.draw(hero.pose);
    } else if (hero.theme === "egyid") {
      if (state === "match") hero.angle = ease(hero.angle, Math.ceil(hero.angle / 360) * 360, 5, dt);
      else if (state !== "invalid") hero.angle += (state === "reading" ? 120 : 30) * dt;
      hero.parts.logo.style.setProperty("--angle", `${hero.angle.toFixed(2)}deg`);
      hero.parts.logo.style.setProperty("--float", `${state === "invalid" ? 0 : (Math.sin(t * 1.3) * 5).toFixed(2)}px`);
      hero.parts.reflection.style.setProperty("--angle", `${hero.angle.toFixed(2)}deg`);
    } else if (hero.theme === "nid") {
      const aim = hero.pointer || { x: Math.sin(t * 0.5) * 0.35, y: Math.cos(t * 0.4) * 0.25 };
      hero.tilt.x = ease(hero.tilt.x, -aim.y * 14 + 6, 6, dt);
      hero.tilt.y = ease(hero.tilt.y, aim.x * 18, 6, dt);
      hero.parts.card.style.setProperty("--tilt-x", `${hero.tilt.x.toFixed(2)}deg`);
      hero.parts.card.style.setProperty("--tilt-y", `${hero.tilt.y.toFixed(2)}deg`);
    } else {
      hero.parts.sheet.style.setProperty("--float", `${(Math.sin(t * 1.3 + hero.phase) * 4).toFixed(2)}px`);
    }
  }
  if (running) frame = requestAnimationFrame(step);
  else last = 0;
}

function wake() {
  if (!frame && !reduced()) frame = requestAnimationFrame(step);
}

const watcher = typeof IntersectionObserver !== "undefined"
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const hero = entry.target.__hero;
      if (!hero) continue;
      hero.visible = entry.isIntersecting;
      entry.target.classList.toggle("is-paused", !entry.isIntersecting);
    }
    wake();
  })
  : null;

document.addEventListener("visibilitychange", () => {
  for (const hero of heroes) hero.root.classList.toggle("is-paused", document.hidden || !hero.visible);
  if (!document.hidden) wake();
});

function pointerOn(root, hero) {
  root.addEventListener("pointermove", (event) => {
    const box = root.getBoundingClientRect();
    hero.pointer = { x: (event.clientX - box.left) / box.width - 0.5, y: (event.clientY - box.top) / box.height - 0.5 };
    if (hero.drag) {
      const dx = event.clientX - hero.drag.x;
      hero.drag.x = event.clientX;
      hero.drag.v = (dx / Math.max(1, box.width)) * 40;
      hero.pose.ry += (dx / Math.max(1, box.width)) * 4;
    }
  });
  root.addEventListener("pointerleave", () => { hero.pointer = null; });
  if (hero.kind === "logo") {
    // Drag to turn the mark; let go and it carries on, then slows to its own pace.
    root.addEventListener("pointerdown", (event) => { hero.drag = { x: event.clientX, v: 0 }; wake(); });
    const release = () => { if (hero.drag) { hero.fling = hero.drag.v; hero.drag = null; } };
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);
  }
}

/** Build the live scene inside `root` (a .hero with its poster). */
export function mountHero(root, theme) {
  const kind = { egyid: "logo", nid: "card", army: "certificate" }[theme] || null;
  const hero = {
    root, theme, kind, gl: null, parts: null, angle: -25, tilt: { x: 8, y: -14 },
    pose: { rx: 0, ry: kind === "logo" ? -0.5 : 0, rz: 0, y: 0, mute: 0, time: 0, stamp: 0 },
    spin: 0.5, fling: 0, flip: 0, drag: null, pointer: null, visible: true, phase: Math.random() * 6,
  };
  if (kind) {
    const canvas = document.createElement("canvas");
    canvas.className = "gl";
    canvas.setAttribute("aria-hidden", "true");
    root.prepend(canvas);
    hero.gl = createObjectScene(canvas, kind, ACCENT[theme]);
    if (hero.gl) {
      // The poster is a flat drawing of the object: with the real one coming, do not crossfade the two.
      root.classList.add("has-gl");
      root.append(el("div", "pulse"));
      canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); heroes.delete(hero); root.classList.remove("is-live", "is-still"); });
    } else {
      canvas.remove();
    }
  }
  if (reduced()) {
    // No motion: one still frame of the 3D object, else the poster.
    if (hero.gl) {
      const draw = () => {
        const stamped = root.closest("[data-state]")?.dataset.state === "match";
        hero.gl.draw({ rx: 0.05, ry: kind === "logo" ? -0.45 : 0.25, rz: 0, y: 0, mute: 0, time: 0, stamp: stamped ? 1 : 0 });
        root.classList.add("is-live", "is-still");
      };
      requestAnimationFrame(draw);
      if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => requestAnimationFrame(draw)).observe(root);
    }
    root.__hero = hero;
    return hero;
  }
  if (!hero.gl) {
    const scene = el("div", "scene");
    scene.setAttribute("aria-hidden", "true");
    root.prepend(scene);
    hero.parts = BUILD_CSS[theme](scene);
  }
  root.__hero = hero;
  heroes.add(hero);
  pointerOn(root, hero);
  const sizeScan = () => root.style.setProperty("--scan-travel", `${Math.round(root.clientHeight * 0.78)}px`);
  sizeScan();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(sizeScan).observe(root);
  watcher?.observe(root);
  // Show the live scene only once it has drawn a frame, so the poster never flickers away early.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("is-live")));
  wake();
  return hero;
}

/** Call when a reader's state changes, so the loop runs again if it had gone idle. */
export function heroStateChanged() {
  wake();
}

/** For tests: is the loop running right now? */
export function loopRunning() {
  return frame !== 0;
}
