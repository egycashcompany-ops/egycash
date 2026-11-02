/* Live capture guide for the ID card camera: a card-shaped frame over the video, and plain-language
 * feedback ("move closer", "hold still", "glare") until the card is framed well enough to read.
 *
 * Everything runs in the browser on a small copy of each video frame (no library, no network):
 *
 *   - Where the card is. The card's border is a long straight edge, so it stands out in the sums of
 *     horizontal / vertical gradient along each column / row of the frame area. The strongest
 *     column peak on each half gives its left/right sides, the strongest row peak its top/bottom.
 *     From those four: is it inside the frame, too small (too far), too big (too close), off
 *     centre, turned (a side found at a different place in the upper and lower halves), or
 *     foreshortened (top narrower than bottom).
 *   - Sharpness: variance of a Laplacian over the card area, and how much the picture moved since
 *     the last frame (a moving phone blurs).
 *   - Glare: the share of the card that is blown out to white.
 *   - Light: the card's mean brightness.
 *
 * When every check passes for a run of frames in a row, the guide captures by itself (auto mode),
 * cropped to the frame plus a margin: the reader then never has to look for the card among the
 * face, the hand and the table, which is where its card finder went wrong.
 *
 * Usage:
 *   const guide = CaptureGuide.attach(videoElement, { onCapture, onUpdate, auto: true });
 *   guide.start(); ... guide.stop();
 *   guide.capture() → JPEG data URL of the framed card (with margin).
 *   CaptureGuide.analyzeImage(imgOrCanvas) → the same verdict for a still image (testing).
 */
(function () {
  "use strict";

  // ISO/IEC 7810 ID-1, the card's width over its height.
  const ID1 = 85.6 / 53.98;
  // Width the analysis runs at. Enough to find a border and judge focus; cheap at 10 frames/s.
  const WORK = 360;
  // The frame's share of the picture's width, landscape and portrait.
  const FRAME_LANDSCAPE = 0.78;
  const FRAME_PORTRAIT = 0.9;
  // How long every check must keep passing before an automatic capture. A single bad frame does
  // not start the count over (a phone's hands shake): see `GRACE_FRAMES`.
  const HOLD_MS = 150;
  const GRACE_FRAMES = 2;
  // Mean difference (0-255) of block averages under which two frames are the same card.
  const SAME_CARD = 9;
  // A frame at least this share as sharp as the best of the last few is "in focus".
  const FOCUS_SETTLED = 0.8;

  const LIMITS = {
    // Card width / frame width.
    tooFar: 0.72,
    tooClose: 1.2,
    // Card centre off the frame centre, as a share of the frame size.
    offCentre: 0.3,
    // Degrees the card may be turned in the frame (the reader straightens it; this is for a card
    // held at a real angle).
    tilt: 12,
    // Top edge vs bottom edge length, relative.
    keystone: 0.1,
    // Laplacian variance at 360 px: below this, the letters are smeared.
    sharp: 70,
    // The back's print is paler than the front's, so the same focus reads as less sharp.
    backSharp: 0.65,
    // Mean absolute change between frames, 0-255. Hand-held phones sit at 3-8 when "still".
    moving: 10,
    // Share of the card's pixels blown out.
    glare: 0.02,
    // Mean brightness of the card, 0-255.
    dark: 70,
    // A side is a step of at least this many levels (0-255) in brightness, or colour at 0.8 of it,
    // in two of the three bands along it.
    step: 5,
    // A card is believed (and the photo taken by itself) only with sides this clear and this much
    // print inside it: empty cloth, wood and a plain wall give faint steps and little detail.
    confidentStep: 17,
    // How the sides chosen are weighed: by their clarity (exponent) and by how large they make the
    // card (exponent). Tuned on real photos placed in the frame at several distances.
    scoreStrength: 0.6,
    scoreSize: 0.5,
    detail: 6,
  };

  const MESSAGES = {
    noCard: "Place the card inside the frame",
    tooFar: "Move closer",
    tooClose: "Move back a little",
    offCentre: "Centre the card in the frame",
    tilt: "Straighten the card",
    keystone: "Hold the phone flat, straight above the card",
    dark: "More light, please",
    glare: "Glare on the card: tilt it slightly or move away from the light",
    moving: "Hold still",
    blurry: "Hold still, the picture is blurred",
    same: "Turn the card over",
    focusing: "Focusing...",
    good: "Got it",
  };

  function frameRect(width, height) {
    const share = width >= height ? FRAME_LANDSCAPE : FRAME_PORTRAIT;
    let w = width * share;
    let h = w / ID1;
    if (h > height * 0.8) { h = height * 0.8; w = h * ID1; }
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
  }

  function greyOf(source, width, height, canvas) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const grey = new Float32Array(width * height);
    const chroma = new Float32Array(width * height);
    for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
      grey[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
      // How coloured, not how bright: a pale card on a pale table differs in this when it barely
      // does in brightness.
      chroma[i] = Math.max(rgba[j], rgba[j + 1], rgba[j + 2]) - Math.min(rgba[j], rgba[j + 1], rgba[j + 2]);
    }
    grey.chroma = chroma;
    return grey;
  }


  function laplacianVariance(grey, width, x0, y0, x1, y1) {
    let sum = 0, sumSq = 0, n = 0;
    for (let y = Math.max(1, y0); y < y1 - 1; y++) {
      for (let x = Math.max(1, x0); x < x1 - 1; x++) {
        const i = y * width + x;
        const v = grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width] - 4 * grey[i];
        sum += v; sumSq += v * v; n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  // The dominant direction of strong edges in a region, in degrees off level, folded into
  // (-45, 45]: the card's border and its printed lines all run along the card, so this is how far
  // the card is turned, whether or not its sides were found.
  function dominantAngle(grey, width, x0, y0, x1, y1) {
    const bins = new Float32Array(90);
    const xa = Math.max(1, Math.round(x0)), xb = Math.min(width - 1, Math.round(x1));
    const ya = Math.max(1, Math.round(y0)), yb = Math.min(grey.length / width - 1, Math.round(y1));
    let total = 0;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const i = y * width + x;
        const gx = grey[i + 1] - grey[i - 1], gy = grey[i + width] - grey[i - width];
        const m = gx * gx + gy * gy;
        if (m < 900) continue; // faint texture says nothing about direction
        let a = Math.atan2(gy, gx) * 180 / Math.PI; // -180..180
        a = ((a % 90) + 90) % 90; // 0..90
        // Weighted by strength squared: the card's border and the printed baselines are the
        // strongest edges, the slanted strokes of the calligraphy are many but fainter.
        bins[Math.floor(a) % 90] += m;
        total += m;
      }
    }
    if (total === 0) return { angle: 0, strength: 0 };
    let best = 0, at = 0;
    for (let b = 0; b < 90; b++) {
      const v = bins[(b + 89) % 90] + 2 * bins[b] + bins[(b + 1) % 90];
      if (v > best) { best = v; at = b; }
    }
    // How much the peak stands out of an even spread (1 = no preferred direction).
    const strength = best / (4 * total / 90);
    const angle = at > 45 ? at - 90 : at;
    return { angle, strength };
  }

  // ── Finding the card's four sides ─────────────────────────────────────────────────────────────
  // A side of the card is a step in brightness or colour that runs the length of the side. The
  // frame is cut into three bands along that length and a position counts only where at least two
  // of them show the step: text and the portrait make strong edges too, but not along a whole side.
  // Several candidates are kept per side and the set that makes a card (its proportions are fixed:
  // ID-1) is chosen, so the portrait's edge is not taken for the card's.

  // Mean of `channel` across a band, per position along the other axis.
  function bandMeans(channel, width, height, vertical, a0, a1, b0, b1) {
    // vertical: one value per column x, averaged over rows [b0, b1); else one per row y over columns.
    const n = vertical ? width : height;
    const out = new Float32Array(n);
    const lo = Math.max(0, Math.round(b0)), hi = Math.min(vertical ? height : width, Math.round(b1));
    const cnt = Math.max(1, hi - lo);
    for (let k = Math.max(0, Math.round(a0)); k < Math.min(n, Math.round(a1)); k++) {
      let sum = 0;
      if (vertical) for (let y = lo; y < hi; y++) sum += channel[y * width + k];
      else for (let x = lo; x < hi; x++) sum += channel[k * width + x];
      out[k] = sum / cnt;
    }
    return out;
  }

  function stepAt(m, k) {
    let before = 0, after = 0;
    for (let d = 2; d <= 6; d++) { before += m[k - d]; after += m[k + d]; }
    return Math.abs(after - before) / 5;
  }

  // Candidate positions for one side within [from, to): [{ at, score }], best first.
  function sideCandidates(grey, width, height, vertical, from, to, bandLo, bandHi) {
    const third = (bandHi - bandLo) / 3;
    const bands = [grey, grey.chroma].map((channel) => {
      const set = [];
      for (let t = 0; t < 3; t++) {
        set.push(bandMeans(channel, width, height, vertical, from - 8, to + 8, bandLo + t * third, bandLo + (t + 1) * third));
      }
      return set;
    });
    const out = [];
    const limit = (vertical ? width : height) - 8;
    for (let k = Math.max(8, Math.round(from)); k < Math.min(limit, Math.round(to)); k++) {
      let best = 0;
      for (let c = 0; c < 2; c++) {
        const steps = bands[c].map((m) => stepAt(m, k)).sort((a, b) => a - b);
        // The middle value: at least two of the three bands show this much.
        const v = steps[1] * (c === 1 ? 0.8 : 1);
        if (v > best) best = v;
      }
      out.push({ at: k, score: best });
    }
    const peaks = [];
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i].score >= out[i - 1].score && out[i].score >= out[i + 1].score && out[i].score >= LIMITS.step) peaks.push(out[i]);
    }
    peaks.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const pk of peaks) if (kept.every((o) => Math.abs(o.at - pk.at) > 6)) kept.push(pk);
    return kept.slice(0, 4);
  }

  /* The card in a frame: { l, r, t, b, strength, inferred } or null. */
  function findCard(grey, width, height, frame) {
    const fw = frame.w, fh = frame.h;
    const yLo = frame.y + 0.22 * fh, yHi = frame.y + 0.78 * fh;
    const xLo = frame.x + 0.22 * fw, xHi = frame.x + 0.78 * fw;
    const L = sideCandidates(grey, width, height, true, frame.x - 0.4 * fw, frame.x + 0.42 * fw, yLo, yHi);
    const R = sideCandidates(grey, width, height, true, frame.x + 0.58 * fw, frame.x + 1.4 * fw, yLo, yHi);
    const T = sideCandidates(grey, width, height, false, frame.y - 0.45 * fh, frame.y + 0.45 * fh, xLo, xHi);
    const B = sideCandidates(grey, width, height, false, frame.y + 0.55 * fh, frame.y + 1.45 * fh, xLo, xHi);
    let best = null;
    // Each side may also be missing (cut off by the frame's edge, or too faint): null stands in.
    for (const l of [...L, null]) for (const r of [...R, null]) for (const t of [...T, null]) for (const b of [...B, null]) {
      const present = [l, r, t, b].filter(Boolean).length;
      if (present < 3) continue;
      let left = l && l.at, right = r && r.at, top = t && t.at, bottom = b && b.at;
      // A missing side follows from the card's proportions.
      if (left == null) left = right - (bottom - top) * ID1;
      else if (right == null) right = left + (bottom - top) * ID1;
      else if (top == null) top = bottom - (right - left) / ID1;
      else if (bottom == null) bottom = top + (right - left) / ID1;
      const w = right - left, h = bottom - top;
      if (w < 0.3 * fw || h < 0.3 * fh) continue;
      const fit = Math.max(0, 1 - Math.abs(Math.log(w / h / ID1)) / 0.2);
      if (fit <= 0) continue;
      const strength = [l, r, t, b].filter(Boolean).reduce((sum, x) => sum + x.score, 0) / present;
      // Four sides over three, then the better fit, then the larger card (the outer edge, not the
      // portrait's or the print's).
      const ratio = w / fw;
      // The outer edge over an inner one: three strong inner features (the portrait's and the
      // print's) must not beat the card's own four sides, which are often fainter.
      const sizeFactor = ratio <= 1.1 ? ratio : Math.max(0.5, 1.1 - (ratio - 1.1) * 1.5);
      const score = Math.pow(strength, LIMITS.scoreStrength) * fit * (present === 4 ? 1 : 0.8) * Math.pow(sizeFactor, LIMITS.scoreSize);
      if (!best || score > best.score) best = { l: left, r: right, t: top, b: bottom, score, inferred: present < 4, strength };
    }
    return best;
  }

  /* One frame → { ok, problems: [codes, worst first], message, frame, card | null, metrics }.
   * `previous` is the last frame's grey image, for the "is it moving" check. */
  function analyze(grey, width, height, previous, side) {
    const frame = frameRect(width, height);
    const midX = frame.x + frame.w / 2, midY = frame.y + frame.h / 2;
    const found = findCard(grey, width, height, frame);

    const metrics = { sides: found ? (found.inferred ? 3 : 4) : 0, step: found ? found.strength : 0 };
    const problems = [];
    let card = null;
    // Turned in the frame: judged on the edges' own direction. Inside the frame only: a wood grain
    // or a patterned cloth beside the card has a direction too.
    const direction = dominantAngle(grey, width, frame.x + frame.w * 0.05, frame.y + frame.h * 0.05,
      frame.x + frame.w * 0.95, frame.y + frame.h * 0.95);
    metrics.tilt = direction.angle;
    metrics.direction = direction.strength;

    if (found) {
      card = { x: found.l, y: found.t, w: found.r - found.l, h: found.b - found.t };
      const size = card.w / frame.w;
      const dx = (card.x + card.w / 2 - midX) / frame.w;
      const dy = (card.y + card.h / 2 - midY) / frame.h;
      metrics.size = size;
      metrics.offCentre = Math.max(Math.abs(dx), Math.abs(dy));
      metrics.aspect = card.w / card.h;
      // A card a little off in size or place is still read well (the reader finds the card and
      // straightens it), so only real misses count.
      if (size < LIMITS.tooFar) problems.push("tooFar");
      else if (size > LIMITS.tooClose) problems.push("tooClose");
      // Off to one side, or partly out of the picture: the whole card has to be in it.
      const outside = card.x < -0.02 * width || card.y < -0.02 * height || card.x + card.w > 1.02 * width || card.y + card.h > 1.02 * height;
      if ((metrics.offCentre > LIMITS.offCentre || outside) && !problems.length) problems.push("offCentre");
    } else {
      problems.push("noCard");
    }

    // Light, glare and focus are measured on the card if found, else on the frame.
    const area = card || frame;
    const ax0 = Math.max(0, Math.round(area.x + area.w * 0.04));
    const ax1 = Math.min(width, Math.round(area.x + area.w * 0.96));
    const ay0 = Math.max(0, Math.round(area.y + area.h * 0.06));
    const ay1 = Math.min(height, Math.round(area.y + area.h * 0.94));
    let sum = 0, blown = 0, n = 0, change = 0;
    for (let y = ay0; y < ay1; y++) {
      for (let x = ax0; x < ax1; x++) {
        const i = y * width + x;
        const v = grey[i];
        sum += v; n++;
        if (v >= 248) blown++;
        if (previous) change += Math.abs(v - previous[i]);
      }
    }
    // How much print there is inside (mean gradient) and how much of it is card stock (bright, not
    // strongly coloured): a card has both, a wood table or a cloth has one at most.
    {
      let grad = 0, gn = 0, paper = 0, pn = 0;
      const chroma = grey.chroma;
      for (let y = ay0 + 1; y < ay1 - 1; y += 2) {
        for (let x = ax0 + 1; x < ax1 - 1; x += 2) {
          const i = y * width + x;
          grad += Math.abs(grey[i + 1] - grey[i - 1]) + Math.abs(grey[i + width] - grey[i - width]);
          gn++;
          if (grey[i] > 110 && chroma[i] < 70) paper++;
          pn++;
        }
      }
      metrics.detail = gn ? grad / gn : 0;
      metrics.paper = pn ? paper / pn : 0;
    }
    metrics.brightness = n ? sum / n : 0;
    metrics.glare = n ? blown / n : 0;
    metrics.motion = previous && n ? change / n : 0;
    // On the back, the barcode stays "sharp" under a blur that has already smeared the text, so
    // focus is judged on the printed half above it.
    const sy1 = side === "back" ? Math.round(area.y + area.h * 0.55) : ay1;
    metrics.sharpness = laplacianVariance(grey, width, ax0, ay0, ax1, sy1);

    // Sides and print that are too faint to be a card: not one (see LIMITS.confidentStep).
    if (card && (metrics.step < LIMITS.confidentStep || metrics.detail < LIMITS.detail)) {
      card = null;
      problems.length = 0;
      problems.push("noCard");
    }
    if (metrics.brightness < LIMITS.dark) problems.push("dark");
    if (metrics.glare > LIMITS.glare) problems.push("glare");
    if (metrics.motion > LIMITS.moving) problems.push("moving");
    else if (card && metrics.sharpness < (side === "back" ? LIMITS.sharp * LIMITS.backSharp : LIMITS.sharp)) problems.push("blurry");

    // Worst first: without a card nothing else matters; then distance and framing; then the rest.
    const order = ["noCard", "dark", "tooFar", "tooClose", "offCentre", "tilt", "keystone", "glare", "moving", "blurry"];
    problems.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const ok = problems.length === 0;
    return { ok, problems, message: MESSAGES[ok ? "good" : problems[0]], frame, card, metrics };
  }

  // Are these two frames the same card in the same place? Compared on a coarse grid of block
  // averages over the frame's area, so a hand's small shift does not make a card look new, while
  // the other side of the card (portrait against barcode) differs a great deal.
  function similar(a, b, width, height) {
    if (!a || !b || a.length !== b.length) return false;
    const f = frameRect(width, height);
    const cols = 24, rows = 14;
    let total = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(f.x + (f.w * c) / cols), x1 = Math.round(f.x + (f.w * (c + 1)) / cols);
        const y0 = Math.round(f.y + (f.h * r) / rows), y1 = Math.round(f.y + (f.h * (r + 1)) / rows);
        let sa = 0, sb = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * width + x; sa += a[i]; sb += b[i]; n++; }
        if (n) total += Math.abs(sa - sb) / n;
      }
    }
    return total / (rows * cols) < SAME_CARD;
  }

  function analyzeImage(source, side) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    const width = WORK, height = Math.round(WORK * sh / sw);
    const grey = greyOf(source, width, height, document.createElement("canvas"));
    return analyze(grey, width, height, null, side);
  }

  // Where the video is drawn inside its box, for `object-fit: contain`.
  function displayed(video) {
    const box = video.getBoundingClientRect();
    const host = video.parentElement.getBoundingClientRect();
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const scale = Math.min(box.width / vw, box.height / vh);
    const w = vw * scale, h = vh * scale;
    return { left: box.left - host.left + (box.width - w) / 2, top: box.top - host.top + (box.height - h) / 2, scale };
  }

  function attach(video, options = {}) {
    const auto = options.auto !== false;
    const host = video.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    // The video fills its box exactly and is letterboxed inside it. Left to the page's own rule
    // (height: 100% inside a box with a fixed landscape ratio) a phone's portrait stream grew to
    // its own height, taller than the box, and the frame was drawn below the visible part of it.
    video.style.cssText += ";position:absolute;inset:0;width:100%;height:100%;object-fit:contain";
    // The box takes the stream's own proportions (a phone gives 9:16 held upright), within what
    // fits on the screen with the buttons below it.
    function fitBox() {
      if (!video.videoWidth) return;
      host.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      host.style.maxHeight = "62vh";
    }
    video.addEventListener("loadedmetadata", fitBox);

    const overlay = document.createElement("div");
    overlay.className = "cg-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <svg class="cg-svg" aria-hidden="true"><defs><mask id="cg-hole">
        <rect width="100%" height="100%" fill="white"/><rect class="cg-hole" rx="10" fill="black"/>
      </mask></defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.45)" mask="url(#cg-hole)"/>
        <rect class="cg-frame" rx="10" fill="none" stroke-width="2"/>
        <path class="cg-corners" fill="none" stroke-width="6" stroke-linecap="round"/>
        <rect class="cg-card" fill="none" stroke-width="2" stroke-dasharray="6 5"/>
      </svg>
      <div class="cg-hint" role="status" aria-live="polite"></div>
      <div class="cg-bar"><i></i></div>`;
    host.appendChild(overlay);
    if (!document.getElementById("cg-style")) {
      const style = document.createElement("style");
      style.id = "cg-style";
      style.textContent = `
        .cg-overlay { position:absolute; inset:0; pointer-events:none; }
        .cg-overlay[hidden] { display:none; }
        .cg-svg { position:absolute; inset:0; width:100%; height:100%; }
        .cg-frame { stroke: rgba(255,255,255,.55); }
        .cg-corners { stroke: #fff; transition: stroke .2s; }
        .cg-card { stroke: rgba(255,214,10,.9); }
        .cg-overlay[data-state=good] .cg-corners { stroke: #34c759; }
        .cg-overlay[data-state=near] .cg-corners { stroke: #ffd60a; }
        .cg-hint { position:absolute; left:50%; bottom:6%; transform:translateX(-50%); max-width:90%;
          padding:8px 14px; border-radius:999px; background:rgba(0,0,0,.72); color:#fff;
          font:600 15px/1.3 system-ui, sans-serif; text-align:center; }
        .cg-overlay[data-state=good] .cg-hint { background:rgba(26,127,55,.92); }
        .cg-bar { position:absolute; left:50%; top:5%; width:120px; height:5px; margin-left:-60px;
          border-radius:3px; background:rgba(255,255,255,.3); overflow:hidden; opacity:0; transition:opacity .2s; }
        .cg-bar i { display:block; height:100%; width:0; background:#34c759; }
        .cg-overlay[data-state=good] .cg-bar { opacity:1; }
        @media (prefers-reduced-motion: reduce) { .cg-corners, .cg-bar { transition:none; } }`;
      document.head.appendChild(style);
    }

    const canvas = document.createElement("canvas");
    // What the last automatic capture saw, to tell a new card from the one just taken: the back's
    // camera opens with the front still in the frame, and must not take it again as the back.
    // (This replaced waiting for the frame to be empty once, which left a back held in the frame
    // from the start green and never captured.)
    let previous = null, timer = null, steadySince = null, bad = 0, last = null, captured = false;
    let lastShot = null, avoid = null, latestGrey = null;
    let sharpHistory = [];

    function layout(result) {
      const { left, top, scale } = displayed(video);
      const k = (video.videoWidth || 1) / WORK; // analysis px → video px
      const place = (r) => ({ x: left + r.x * k * scale, y: top + r.y * k * scale, w: r.w * k * scale, h: r.h * k * scale });
      const f = place(result.frame);
      for (const sel of [".cg-hole", ".cg-frame"]) {
        const el = overlay.querySelector(sel);
        el.setAttribute("x", f.x); el.setAttribute("y", f.y);
        el.setAttribute("width", f.w); el.setAttribute("height", f.h);
      }
      const c = Math.min(f.w, f.h) * 0.16;
      overlay.querySelector(".cg-corners").setAttribute("d", [
        `M${f.x},${f.y + c}V${f.y}H${f.x + c}`,
        `M${f.x + f.w - c},${f.y}H${f.x + f.w}V${f.y + c}`,
        `M${f.x + f.w},${f.y + f.h - c}V${f.y + f.h}H${f.x + f.w - c}`,
        `M${f.x + c},${f.y + f.h}H${f.x}V${f.y + f.h - c}`,
      ].join(""));
      const cardEl = overlay.querySelector(".cg-card");
      if (result.card && !result.ok) {
        const r = place(result.card);
        cardEl.setAttribute("x", r.x); cardEl.setAttribute("y", r.y);
        cardEl.setAttribute("width", Math.max(r.w, 0)); cardEl.setAttribute("height", Math.max(r.h, 0));
        cardEl.style.display = "";
      } else {
        cardEl.style.display = "none";
      }
    }

    function tick() {
      if (!video.videoWidth || video.readyState < 2) return;
      fitBox();
      const width = WORK, height = Math.round(WORK * video.videoHeight / video.videoWidth);
      const grey = greyOf(video, width, height, canvas);
      const fresh = previous && previous.length === grey.length ? previous : null;
      const side = typeof options.side === "function" ? options.side() : options.side;
      const result = analyze(grey, width, height, fresh, side);
      // Quality balance: the photo is taken the moment the card is framed, but not while the camera
      // is still focusing. Its sharpness over the last moments tells: a frame well below the best of
      // them is mid-focus, and the next ones are sharper.
      sharpHistory.push(result.metrics.sharpness);
      if (sharpHistory.length > 8) sharpHistory.shift();
      if (result.ok && sharpHistory.length >= 3 && result.metrics.sharpness < FOCUS_SETTLED * Math.max(...sharpHistory)) {
        result.ok = false;
        result.problems = ["focusing"];
        result.message = MESSAGES.focusing;
      }
      // Still the card just captured (as the other side)? Then it is not ready, whatever else says.
      if (avoid && result.ok && similar(grey, avoid.grey, width, height)) {
        result.ok = false;
        result.problems = ["same"];
        result.message = MESSAGES.same;
      } else if (avoid && result.ok) {
        avoid = null; // a different card is in the frame: nothing more to compare against
      }
      previous = grey;
      last = result;
      latestGrey = grey;
      const now = performance.now();
      if (result.ok) {
        bad = 0;
        if (steadySince === null) steadySince = now;
      } else {
        // A frame or two out of place is not the card moving: the hold carries on through them.
        if (++bad > GRACE_FRAMES) steadySince = null;
      }
      const held = steadySince === null ? 0 : now - steadySince;
      // "Near": only focus or steadiness left to sort out, the framing is right.
      const near = !result.ok && result.problems.every((p) => p === "moving" || p === "blurry" || p === "focusing");
      overlay.dataset.state = result.ok ? "good" : near ? "near" : "bad";
      const hint = overlay.querySelector(".cg-hint");
      if (hint.textContent !== result.message) hint.textContent = result.message;
      overlay.querySelector(".cg-bar i").style.width = `${Math.min(100, (100 * held) / HOLD_MS)}%`;
      layout(result);
      if (options.onUpdate) options.onUpdate(result);
      if (result.ok && held >= HOLD_MS && !captured && auto && options.onCapture) {
        captured = true;
        lastShot = { grey: latestGrey, side };
        options.onCapture(capture());
      }
    }

    // What is sent: the card where it was found (with a margin), else the frame with a wide one, at
    // the video's full resolution. Cutting to the frame alone cut off a card held a little too close.
    function capture(quality = 0.92) {
      const vw = video.videoWidth, vh = video.videoHeight;
      const k = vw / WORK; // analysis px -> video px
      let x, y, w, h;
      const card = last && last.card;
      if (card) {
        const m = 0.18 * Math.max(card.w, card.h);
        x = (card.x - m) * k; y = (card.y - m) * k; w = (card.w + 2 * m) * k; h = (card.h + 2 * m) * k;
      } else {
        const f = frameRect(vw, vh);
        x = f.x - 0.35 * f.w; y = f.y - 0.35 * f.h; w = 1.7 * f.w; h = 1.7 * f.h;
      }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(vw - x, w); h = Math.min(vh - y, h);
      const out = document.createElement("canvas");
      out.width = Math.round(w); out.height = Math.round(h);
      out.getContext("2d").drawImage(video, x, y, w, h, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", quality);
    }

    return {
      // Starting for the side after another: the card already captured is not taken again.
      start() {
        const side = typeof options.side === "function" ? options.side() : options.side;
        avoid = lastShot && lastShot.side !== side ? lastShot : null;
        captured = false; steadySince = null; bad = 0; previous = null; overlay.hidden = false; sharpHistory = [];
        if (!timer) timer = setInterval(tick, 70);
      },
      stop() { clearInterval(timer); timer = null; overlay.hidden = true; },
      capture,
      get state() { return last; },
    };
  }

  // After a read: what to change in the photo, from the service's own quality reasons. The page
  // used to say "too far away" for every unreadable photo, also a sharp close one that was simply
  // blurred or glared, which sent people back to take the same photo again.
  const RETAKE = [
    ["blurred", "is blurred: hold the phone steady and tap the card to focus"],
    ["glare", "has glare on the card: tilt it a little or move away from the light"],
    ["low_contrast", "is too dark or faded: take it in better light"],
    ["too_small", "is too far away: move closer so the card fills most of the photo"],
    ["card_not_located", "does not show the card's edges clearly: lay it on a plain, darker surface"],
  ];
  function retakeAdvice(body) {
    const quality = body.quality || {}, diagnostics = body.diagnostics || {};
    const notes = [];
    let unreadable = false;
    for (const side of ["front", "back"]) {
      const reasons = quality[side]?.reasons || [];
      const lost = !!diagnostics[side]?.tooFarToRead;
      const found = RETAKE.find(([code]) => reasons.includes(code));
      if (!found && !lost) continue;
      // Only the worst problem, and only where it mattered: an unreadable side, or a small card.
      if (!lost && found[0] !== "too_small") continue;
      unreadable = unreadable || lost;
      const name = side === "front" ? "The front photo" : "The back photo";
      notes.push(`${name} ${found ? found[1] : "could not be read: retake it closer and sharper"}.`);
    }
    // The number itself was not in the photo (cut off, covered, washed out): said first, because
    // retaking the same photo more sharply would not help.
    if (diagnostics.numberNotVisible) {
      notes.unshift("The ID number could not be read: keep the whole number line inside the photo, uncovered and not washed out by light.");
      unreadable = true;
    }
    return notes.length ? { text: notes.join(" "), unreadable } : null;
  }

  // After a read: what the service did about the photos being in the wrong place.
  function sideNote(body) {
    const d = body.diagnostics || {};
    const check = d.cardCheck;
    if (check && check.verdict === "not_national_id") {
      const which = Object.entries(check.sides).filter(([, v]) => v === "no").map(([k]) => k).join(" and ");
      return `The ${which} photo does not look like an Egyptian national ID card (another document?). Photograph the national ID itself.`;
    }
    if (d.sidesSwapped) {
      return "The photos were in the wrong boxes (front in the back box, or back in the front box). They were read as the sides they show.";
    }
    if (d.sameSide) return `Both photos show the ${d.sameSide} of the card, so only one was read. Add a photo of the ${d.sameSide === "front" ? "back" : "front"} for the rest of the data.`;
    if (d.front?.sideMismatch) return "The photo in the front box looks like the back of the card.";
    if (d.back?.sideMismatch) return "The photo in the back box looks like the front of the card.";
    return null;
  }

  // ── Photos: loading, limits, previews ─────────────────────────────────────────────────────────
  // What the page sends is limited so a photo of any size can be taken or chosen: the service takes
  // 32 MB a request, two photos at most, and a phone's browser cannot always draw a 100-megapixel
  // picture. Each photo is brought down in steps until it fits, and the preview is a small copy.
  const SIDE_STEPS = [4000, 3200, 2600, 2000, 1600];
  const MAX_DATA_URL = 7e6; // characters of base64: about 5 MB of JPEG
  const MAX_FILE_BYTES = 40e6;
  const THUMB_SIDE = 900;

  /* A decoded picture → { url, width, height, reduced }: a JPEG that fits the limits. */
  function encodePhoto(source, width, height) {
    let last = null;
    for (let i = 0; i < SIDE_STEPS.length; i++) {
      const scale = Math.min(1, SIDE_STEPS[i] / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
      let url = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(source, 0, 0, w, h);
        url = canvas.toDataURL("image/jpeg", i === 0 ? 0.92 : 0.86);
      } catch { continue; } // too big for this browser's canvas: try smaller
      if (!url || url.length < 200) continue; // some browsers answer "data:," for a canvas too large
      last = { url, width: w, height: h, reduced: i > 0 };
      if (url.length <= MAX_DATA_URL) return last;
    }
    if (last) return last;
    throw new Error("The photo could not be prepared. Try a smaller one.");
  }

  /* A chosen file → the same. Tries the usual way, then ways that cope with very large pictures. */
  async function photoFromFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`That photo is too large (${Math.round(file.size / 1e6)} MB). Choose one under ${MAX_FILE_BYTES / 1e6} MB.`);
    }
    const url = URL.createObjectURL(file);
    try {
      // Through <img> first: it applies the photo's own rotation on every browser.
      const img = new Image();
      img.src = url;
      await img.decode();
      return encodePhoto(img, img.naturalWidth, img.naturalHeight);
    } catch {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return encodePhoto(bitmap, bitmap.width, bitmap.height);
      } catch {
        // A picture too large to decode whole: have the browser shrink it while it decodes.
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: 2400, resizeQuality: "medium" });
        return encodePhoto(bitmap, bitmap.width, bitmap.height);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* A JPEG data URL → a small one for showing. Resolves to the original if it cannot be shrunk. */
  async function thumbnail(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1) return url;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  // The camera to use: the main rear lens, by its name. Phones list a "dual" or "triple" camera that
  // switches lenses on its own, an ultra-wide and a telephoto next to the main one; a card is read
  // with the main lens alone. (Labels exist once the camera has been allowed.)
  function mainRearCamera(devices) {
    const rear = devices.filter((d) => d.kind === "videoinput" && /back|rear|environment|facing back/i.test(d.label || ""));
    const plain = (d) => !/(dual|triple|ultra|tele|macro|depth)/i.test(d.label || "");
    return rear.find((d) => /^back camera$/i.test((d.label || "").trim())) || rear.find(plain) || null;
  }

  window.CaptureGuide = { _debug: { sideCandidates, findCard, greyOf, frameRect, dominantAngle }, encodePhoto, photoFromFile, thumbnail, mainRearCamera, attach, analyze, analyzeImage, frameRect, retakeAdvice, sideNote, LIMITS, MESSAGES };
})();
