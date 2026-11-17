// «قص الوجه من صفحة A4»: the employee's photo arrives printed on an A4 sheet (a scan, as a PDF or a
// picture), and HR used to cut the face out by hand. Here the sheet is drawn, the face is found, and
// a crop in the ID card's own photo shape is proposed around it — HR can still move it before saving.
//
// Everything runs in the browser: the sheet never leaves HR's computer and costs the server nothing.
// Only the finished crop is uploaded, through the photo's ordinary route and rules.
//
//   * The sheet: page 1 of a PDF via pdf.js, or the picture itself — drawn to a canvas.
//   * A PDF's PICTURES first. A photo may be printed tiny — 1 x 1.3 cm in a corner of the page,
//     even stored as two strips — and on the whole page drawn at 200 dpi its face is a few dozen
//     pixels, too small to find. But a PDF knows where its pictures are and keeps them at their own
//     resolution, so each picture's area (touching strips joined) is drawn on its own, enlarged,
//     and searched; the crop is then cut from that sharp drawing. The whole page is the fallback.
//   * The face: MediaPipe's BlazeFace (a 230 KB model served from `/models`, WebAssembly from this
//     origin). It is a close-range model, so a sheet is searched whole and then in overlapping
//     tiles, coarse to fine (down to an eighth of its width, for a small photo on a scan), stopping
//     at the first size that finds a face with confidence; the most confident face wins.
//   * The crop: the card's frame (55.65 x 70.56 pt), head and shoulders — the face about a third of
//     the frame's height, a little above the middle, as the current cards are.
import type * as PdfJsModule from 'pdfjs-dist';
import { PHOTO_ASPECT } from '../id-card/card-render';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FoundFace extends Rect {
  score: number;
}

/** A PDF, or a picture that is shaped like a page (a scan) rather than like a portrait photo. */
export const SHEET_MIME_TYPES = ['application/pdf'] as const;
/** Sheets are read here and never uploaded, so they may be larger than a photo. */
export const SHEET_MAX_MB = 25;

export const isPdf = (file: File): boolean =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/** A4 is 1 : 1.414; a scan of one, either way up, within a little. */
export const looksLikePage = (width: number, height: number): boolean => {
  const ratio = Math.max(width, height) / Math.min(width, height);
  return ratio > 1.3 && ratio < 1.55 && Math.max(width, height) >= 1200;
};

/** The longest side the sheet is drawn at: about 200 dpi on A4 — the photo's detail survives. */
const SHEET_LONG_SIDE = 2400;

const canvasOf = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

type PdfJs = typeof PdfJsModule;
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>;

const openPdf = async (file: File) => {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  return { pdfjs, doc };
};

/**
 * One area of a PDF page (in the page's points, top-left origin), drawn white-backed at `scale`.
 * `print`: drawn straight through, not paced to the screen's refresh — which stops while the tab is
 * in the background, and would leave the crop waiting until HR came back to it.
 */
const drawPdfArea = async (
  page: PdfPage,
  area: Rect,
  scale: number,
): Promise<HTMLCanvasElement> => {
  const viewport = page.getViewport({ scale });
  const canvas = canvasOf(area.w * scale, area.h * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    intent: 'print',
    transform: [1, 0, 0, 1, -area.x * scale, -area.y * scale],
  }).promise;
  return canvas;
};

/** The whole page at about 200 dpi. */
const drawPdfPage = (page: PdfPage): Promise<HTMLCanvasElement> => {
  const base = page.getViewport({ scale: 1 });
  return drawPdfArea(
    page,
    { x: 0, y: 0, w: base.width, h: base.height },
    SHEET_LONG_SIDE / Math.max(base.width, base.height),
  );
};

/** Page 1 of a PDF, drawn white-backed at about 200 dpi. */
const drawPdf = async (file: File): Promise<HTMLCanvasElement> => {
  const { doc } = await openPdf(file);
  try {
    return await drawPdfPage(await doc.getPage(1));
  } finally {
    void doc.destroy();
  }
};

/** Rectangles that overlap or touch (within `gap`) joined into one — a photo stored as strips. */
export const mergeRects = (rects: readonly Rect[], gap = 2): Rect[] => {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i] as Rect;
        const b = out[j] as Rect;
        const touch =
          a.x <= b.x + b.w + gap &&
          b.x <= a.x + a.w + gap &&
          a.y <= b.y + b.h + gap &&
          b.y <= a.y + a.h + gap;
        if (!touch) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        out[i] = {
          x,
          y,
          w: Math.max(a.x + a.w, b.x + b.w) - x,
          h: Math.max(a.y + a.h, b.y + b.h) - y,
        };
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out;
};

interface PdfPicture extends Rect {
  /** The picture's own pixels along its longest side — how sharp it can be drawn. */
  pixels: number;
}

/**
 * Where page 1's pictures are, in points from its top-left, touching strips joined, largest first.
 * Read from the page's drawing instructions: every image is the unit square under the current
 * transform, so its corners give its place.
 */
const pdfPictures = async (pdfjs: PdfJs, page: PdfPage): Promise<PdfPicture[]> => {
  const { OPS, Util } = pdfjs;
  const viewport = page.getViewport({ scale: 1 });
  const list = await page.getOperatorList({ intent: 'print' });
  type M = [number, number, number, number, number, number];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const found: PdfPicture[] = [];
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as M) as M;
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = (args?.[0] as M | null) ?? null;
      if (matrix !== null) ctm = Util.transform(ctm, matrix) as M;
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => Util.applyTransform([u as number, v as number], ctm));
      const [x0, y0, x1, y1] = viewport.convertToViewportRectangle([
        Math.min(...corners.map((c) => c[0] as number)),
        Math.min(...corners.map((c) => c[1] as number)),
        Math.max(...corners.map((c) => c[0] as number)),
        Math.max(...corners.map((c) => c[1] as number)),
      ]) as [number, number, number, number];
      const image = args?.[0] as { width?: number; height?: number } | undefined;
      const w = Number(args?.[1] ?? image?.width ?? 0);
      const h = Number(args?.[2] ?? image?.height ?? 0);
      found.push({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
        pixels: Math.max(w, h),
      });
    }
  });
  // Strips joined, each keeping the sharpest of its parts; tiny marks (a logo, a stamp dot) left out.
  return mergeRects(found)
    .map((r) => ({
      ...r,
      pixels: Math.max(
        0,
        ...found
          .filter(
            (f) =>
              f.x >= r.x - 1 &&
              f.y >= r.y - 1 &&
              f.x + f.w <= r.x + r.w + 1 &&
              f.y + f.h <= r.y + r.h + 1,
          )
          .map((f) => f.pixels),
      ),
    }))
    .filter((r) => r.w >= 14 && r.h >= 14)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 8);
};

/** A picture drawn at its own sharpness, at least ~900 px and at most 3000 px along its long side. */
const pictureScale = (p: PdfPicture): number => {
  const long = Math.max(p.w, p.h);
  const wanted = Math.min(3000, Math.max(900, p.pixels * 1.5));
  return wanted / long;
};

/** A picture, drawn as it is (shrunk if it is larger than the sheet size). */
const drawPicture = async (file: File): Promise<HTMLCanvasElement> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, SHEET_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
};

/** The sheet, ready to search and crop. */
export const drawSheet = (file: File): Promise<HTMLCanvasElement> =>
  isPdf(file) ? drawPdf(file) : drawPicture(file);

// ---------------------------------------------------------------------------------------------
// Finding the face

type Detector = {
  detect: (image: HTMLCanvasElement) => {
    detections: Array<{
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      categories: Array<{ score: number }>;
    }>;
  };
};
let detector: Promise<Detector> | null = null;

/** One detector for the session, made the first time a sheet is opened. */
const faceDetector = (): Promise<Detector> => {
  detector ??= (async () => {
    const [{ FaceDetector }, loader, binary] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      import('/mediapipe-wasm/vision_wasm_internal.js?url'),
      import('/mediapipe-wasm/vision_wasm_internal.wasm?url'),
    ]);
    const made = await FaceDetector.createFromOptions(
      { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default },
      {
        baseOptions: {
          modelAssetPath: `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      },
    );
    return made as unknown as Detector;
  })().catch((error: unknown) => {
    detector = null;
    throw error;
  });
  return detector;
};

/** How finely a sheet is cut: the whole, then squares of 1/2 … 1/8 of its width. */
const LEVELS = [1, 2, 3, 4, 6, 8] as const;

/** The tiles of each level, coarse to fine; neighbouring tiles overlap by half. */
export const searchLevels = (width: number, height: number): Rect[][] =>
  LEVELS.map((parts) => {
    if (parts === 1) return [{ x: 0, y: 0, w: width, h: height }];
    const side = Math.round(Math.min(width, height) / parts);
    const step = Math.max(1, Math.round(side / 2));
    const tiles: Rect[] = [];
    for (let y = 0; ; y += step) {
      const ty = Math.min(y, Math.max(0, height - side));
      for (let x = 0; ; x += step) {
        const tx = Math.min(x, Math.max(0, width - side));
        tiles.push({ x: tx, y: ty, w: Math.min(side, width - tx), h: Math.min(side, height - ty) });
        if (tx + side >= width) break;
      }
      if (ty + side >= height) break;
    }
    return tiles;
  });

/** Every tile, coarse to fine. */
export const searchTiles = (width: number, height: number): Rect[] =>
  searchLevels(width, height).flat();

/** A face this sure ends the search at the size that found it. */
const SURE = 0.75;

/** The model sees 128 px; each tile is handed to it at a size that keeps a small face findable. */
const TILE_INPUT = 512;

/** The most confident face on the sheet, in the sheet's pixels — or null when there is none. */
export const findFace = async (sheet: HTMLCanvasElement): Promise<FoundFace | null> => {
  const model = await faceDetector();
  const tile = canvasOf(TILE_INPUT, TILE_INPUT);
  const ctx = tile.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  let best = null as FoundFace | null;
  for (const level of searchLevels(sheet.width, sheet.height)) {
    for (const area of level) {
      const scale = TILE_INPUT / Math.max(area.w, area.h);
      tile.width = Math.round(area.w * scale);
      tile.height = Math.round(area.h * scale);
      ctx.drawImage(sheet, area.x, area.y, area.w, area.h, 0, 0, tile.width, tile.height);
      for (const d of model.detect(tile).detections) {
        const box = d.boundingBox;
        const score = d.categories[0]?.score ?? 0;
        if (box === undefined || (best !== null && score <= best.score)) continue;
        best = {
          x: area.x + box.originX / scale,
          y: area.y + box.originY / scale,
          w: box.width / scale,
          h: box.height / scale,
          score,
        };
      }
    }
    // Found at this size: finer tiles would only find the same face again, slower.
    if (best !== null && best.score >= SURE) break;
  }
  return best;
};

/** Where the face is: the drawing it was found on (cropped from), and the crop around it. */
export interface Located {
  sheet: HTMLCanvasElement;
  crop: Rect | null;
}

/**
 * The face in a file, wherever and however small it is printed: a PDF's pictures first (each drawn
 * sharp, on its own), then the whole page; a picture is searched as it is. `crop` is null when no
 * face was found — `sheet` is then the whole page, for HR to place the frame on.
 */
export const locateFace = async (file: File): Promise<Located> => {
  if (!isPdf(file)) {
    const sheet = await drawPicture(file);
    const face = await findFace(sheet);
    return { sheet, crop: face === null ? null : cropAround(face, sheet.width, sheet.height) };
  }
  const { pdfjs, doc } = await openPdf(file);
  try {
    const page = await doc.getPage(1);
    let best: { sheet: HTMLCanvasElement; face: FoundFace } | null = null;
    for (const picture of await pdfPictures(pdfjs, page).catch(() => [])) {
      const sheet = await drawPdfArea(page, picture, pictureScale(picture));
      const face = await findFace(sheet);
      if (face !== null && (best === null || face.score > best.face.score)) best = { sheet, face };
      if (best !== null && best.face.score >= 0.9) break;
    }
    if (best !== null) {
      return {
        sheet: best.sheet,
        crop: cropAround(best.face, best.sheet.width, best.sheet.height),
      };
    }
    const sheet = await drawPdfPage(page);
    const face = await findFace(sheet);
    return { sheet, crop: face === null ? null : cropAround(face, sheet.width, sheet.height) };
  } finally {
    void doc.destroy();
  }
};

// ---------------------------------------------------------------------------------------------
// The crop

/** The frame's height over the face box's height: head, neck and the top of the shoulders. */
const FRAME_PER_FACE = 2.7;
/** How far above the face box the frame begins, in face heights: room for the hair. */
const HEADROOM = 0.8;

/** The card-shaped crop around a face, kept inside the sheet. */
export const cropAround = (face: Rect, sheetW: number, sheetH: number): Rect => {
  let h = face.h * FRAME_PER_FACE;
  let w = h * PHOTO_ASPECT;
  // Never larger than the sheet itself.
  const fit = Math.min(1, sheetW / w, sheetH / h);
  h *= fit;
  w *= fit;
  const cx = face.x + face.w / 2;
  return clampRect({ x: cx - w / 2, y: face.y - face.h * HEADROOM * fit, w, h }, sheetW, sheetH);
};

/** A starting crop when no face was found: the card's shape, a third of the sheet, upper middle. */
export const defaultCrop = (sheetW: number, sheetH: number): Rect => {
  const w = sheetW / 3;
  const h = w / PHOTO_ASPECT;
  return clampRect({ x: (sheetW - w) / 2, y: sheetH * 0.12, w, h }, sheetW, sheetH);
};

/** The same rectangle, moved (never resized) back inside the sheet. */
export const clampRect = (r: Rect, sheetW: number, sheetH: number): Rect => ({
  w: r.w,
  h: r.h,
  x: Math.min(Math.max(0, r.x), Math.max(0, sheetW - r.w)),
  y: Math.min(Math.max(0, r.y), Math.max(0, sheetH - r.h)),
});

/** The crop resized about its centre (`factor` > 1 grows it), in the card's shape, kept inside. */
export const resizeCrop = (r: Rect, factor: number, sheetW: number, sheetH: number): Rect => {
  const maxH = Math.min(sheetH, sheetW / PHOTO_ASPECT);
  const h = Math.min(maxH, Math.max(40, r.h * factor));
  const w = h * PHOTO_ASPECT;
  return clampRect({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h }, sheetW, sheetH);
};

/** The photo the card prints from: 600 x 760, the frame's shape, as a JPEG ready to upload. */
export const cropToFile = async (
  sheet: HTMLCanvasElement,
  r: Rect,
  name: string,
): Promise<File> => {
  const outH = 760;
  const out = canvasOf(outH * PHOTO_ASPECT, outH);
  const ctx = out.getContext('2d');
  if (ctx === null) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sheet, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
  if (blob === null) throw new Error('the crop could not be made');
  return new File([blob], `${name.replace(/\.[^.]+$/, '')}-face.jpg`, { type: 'image/jpeg' });
};
