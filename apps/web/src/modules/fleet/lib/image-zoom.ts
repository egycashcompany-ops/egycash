// Zooming a licence scan, as arithmetic.
//
// «الرخصه بعيده ولما عملت زوم بيكبر المتصفح ومش بيكبر الصوره». The browser's own zoom enlarges the
// PAGE — chrome, sidebar, dialog and all — so on a dialog that is already as wide as it is allowed
// to be, it buys the reader almost nothing. What they need bigger is the SCAN: the plate, the
// chassis line, the expiry date. So the picture gets a zoom of its own, and this module is the
// half of it that can be reasoned about — where the image sits after a wheel notch, a drag or a
// button press, with no DOM anywhere in sight.
//
// THE MODEL IS ONE TRANSFORM: `translate(x, y) scale(scale)`, about the centre of the surface.
// The image is laid out to FIT that surface at scale 1 (`object-contain`), so 1 means «the whole
// scan, as large as the dialog allows» and everything above it magnifies that. `x`/`y` are in
// SURFACE pixels — what the reader sees the image move by — which is what makes the drag handler
// a one-liner and the clamp below honest about edges.

export interface ZoomState {
  /** 1 = the whole scan fits the surface. Never less: there is nothing to see zoomed out. */
  scale: number;
  /** Pixels the image is shifted by from centred, as the reader sees it. */
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

/**
 * What the arithmetic needs to know about the screen: the box the reader looks through, and how
 * big the image is inside it at scale 1. Both, because they are not the same thing — a wide scan
 * in a tall box is letterboxed, and clamping the pan against the BOX instead of the image lets a
 * reader drag the picture half out of view and wonder where it went.
 */
export interface ZoomSurface {
  box: Box;
  content: Box;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
/** One press of +, one notch of the wheel. Multiplicative, so every step feels the same size. */
export const ZOOM_STEP = 1.25;
/** Where a double-click lands from fit — big enough to read a licence line, small enough to place. */
export const DOUBLE_CLICK_SCALE = 2.5;

/** The whole scan, centred. What every preview opens at and what «إعادة الضبط» returns to. */
export const FIT: ZoomState = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : MIN_SCALE));

/**
 * The image's size inside the box at scale 1 — `object-contain`, computed rather than measured.
 *
 * Measured would mean reading the element back after every transform, which is both a layout
 * thrash and a lie: `getBoundingClientRect` returns the SCALED box, so feeding it back in would
 * compound. The natural size and the box are stable facts; this derives the rest.
 */
export const containSize = (natural: Box, box: Box): Box => {
  if (natural.width <= 0 || natural.height <= 0) return box;
  const k = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * k, height: natural.height * k };
};

/**
 * Pull the image back until no edge of it is inside the surface — unless it is smaller than the
 * surface in that axis, in which case it stays centred and cannot be dragged at all.
 *
 * This is what stops a reader losing the scan off the side of the box with one flick and having
 * to guess that the way back is the reset button.
 */
export const clampOffset = (state: ZoomState, surface: ZoomSurface): ZoomState => {
  const limit = (content: number, box: number): number =>
    Math.max(0, (content * state.scale - box) / 2);
  const limitX = limit(surface.content.width, surface.box.width);
  const limitY = limit(surface.content.height, surface.box.height);
  // `+ 0` turns the negative zero `Math.max(-0, …)` hands back into a plain one. It renders the
  // same and it is not the same value: a state carrying `-0` is not equal to a fresh `FIT`, so
  // «is this picture where it started» would answer no for a picture that never moved.
  const pin = (value: number, limit_: number): number =>
    Math.min(limit_, Math.max(-limit_, value)) + 0;
  return {
    scale: state.scale,
    x: pin(state.x, limitX),
    y: pin(state.y, limitY),
  };
};

/**
 * Zoom about a POINT, keeping whatever is under it exactly where it is.
 *
 * `point` is in surface coordinates — where the pointer is inside the box. Zooming about the
 * centre instead is the thing that makes a wheel zoom feel broken: the reader points at the plate
 * number, scrolls, and the plate number slides away from the cursor.
 */
export const zoomAt = (
  state: ZoomState,
  factor: number,
  point: { x: number; y: number },
  surface: ZoomSurface,
): ZoomState => {
  const scale = clampScale(state.scale * factor);
  if (scale === state.scale) return clampOffset(state, surface);
  // The pointer, relative to the centre the transform turns about.
  const px = point.x - surface.box.width / 2;
  const py = point.y - surface.box.height / 2;
  const k = scale / state.scale;
  return clampOffset(
    { scale, x: px - (px - state.x) * k, y: py - (py - state.y) * k },
    surface,
  );
};

/** A button press: the same zoom, about the middle of the surface. */
export const zoomByStep = (
  state: ZoomState,
  direction: 1 | -1,
  surface: ZoomSurface,
): ZoomState =>
  zoomAt(
    state,
    direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP,
    { x: surface.box.width / 2, y: surface.box.height / 2 },
    surface,
  );

/** A drag. The offsets are surface pixels, so this is the pointer's own movement. */
export const panBy = (
  state: ZoomState,
  dx: number,
  dy: number,
  surface: ZoomSurface,
): ZoomState => clampOffset({ scale: state.scale, x: state.x + dx, y: state.y + dy }, surface);

/**
 * A double-click: in from fit, all the way back out from anywhere else.
 *
 * Not a cycle through the steps — a double-click is «show me this bit» and then «put it back»,
 * and a reader who has zoomed to 4× wants one gesture that undoes it, not four.
 */
export const toggleZoom = (
  state: ZoomState,
  point: { x: number; y: number },
  surface: ZoomSurface,
): ZoomState =>
  isZoomed(state)
    ? FIT
    : zoomAt(state, DOUBLE_CLICK_SCALE / state.scale, point, surface);

/** Is anything magnified? The tolerance keeps float dust from calling a fitted image zoomed. */
export const isZoomed = (state: ZoomState): boolean => state.scale > MIN_SCALE + 1e-6;

/** What the control prints: «١٠٠٪», as a plain number for the caller to localize. */
export const zoomPercent = (state: ZoomState): number => Math.round(state.scale * 100);
