// The map's own DOM pieces — cluster bubbles, review pins, zone labels, edit handles, the temporary
// pin (docs/12-planning/atm-map-zones.md DM-27, §8.4, §8.9, §8.11).
//
// NEVER AN HTML STRING. Machine and zone names are text people typed, and a `divIcon` whose `html`
// is a string is parsed as markup. Every element here is built with `createElement`, and every word
// on it goes in through `textContent`, so a zone named `<img onerror=…>` is drawn as those
// characters. Colours are set through `style` properties (the CSSOM), never through an attribute
// string. BranchMapPicker's string `html` is safe only because it carries no data.
//
// No Leaflet here: `MapCanvas` wraps these elements in `L.divIcon({ html: element })`. The document
// is passed in, so a suite can build them against a small fake.

/** The part of `Document` this file uses. */
export interface DocLike {
  createElement(tag: string): ElementLike;
}

/** The part of `HTMLElement` this file uses. */
export interface ElementLike {
  className: string;
  textContent: string | null;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
  appendChild(child: ElementLike): unknown;
}

const make = (doc: DocLike, tag: string, className: string, text?: string): ElementLike => {
  const el = doc.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Neutral ink for a cluster, unless exactly one zone is filtered (§8.9). */
export const CLUSTER_INK = '#1f2937';

/** 28–40 px by how many machines the bubble stands for. */
export const clusterSizePx = (count: number): number =>
  Math.round(Math.min(40, 28 + Math.log10(Math.max(1, count)) * 6));

/**
 * A cluster or stack bubble: the count in white on the cluster colour. The bubble is what the
 * marker's own (focusable, `role="button"`) element holds; its `aria-label` is set on that element.
 */
export const clusterElement = (
  doc: DocLike,
  { countText, color, sizePx }: { countText: string; color: string; sizePx: number },
): ElementLike => {
  const el = make(
    doc,
    'span',
    'flex items-center justify-center rounded-full border-[3px] border-white text-sm font-bold text-white shadow-[0_0_0_5px_rgba(30,41,59,0.25)]',
    countText,
  );
  el.style.setProperty('width', `${String(sizePx)}px`);
  el.style.setProperty('height', `${String(sizePx)}px`);
  el.style.setProperty('background-color', color);
  return el;
};

/** A pin under review: a dashed amber ring with «?» (§8.9). */
export const reviewPinElement = (doc: DocLike, { faded }: { faded: boolean }): ElementLike => {
  const el = make(
    doc,
    'span',
    'flex h-5 w-5 items-center justify-center rounded-full border-2 border-dashed border-amber-500 bg-amber-50 text-[11px] font-bold leading-none text-amber-700 shadow',
    '?',
  );
  if (faded) el.style.setProperty('opacity', '0.5');
  return el;
};

/** A zone's name on the map: a white pill «● name · count» (§8.9). Not interactive. */
export const zoneLabelElement = (
  doc: DocLike,
  {
    name,
    countText,
    color,
    dir,
  }: { name: string; countText: string; color: string; dir: 'rtl' | 'ltr' },
): ElementLike => {
  const pill = make(
    doc,
    'span',
    'pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-[13px] font-semibold text-slate-900 shadow [text-shadow:0_0_2px_#fff]',
  );
  pill.setAttribute('dir', dir);
  const dot = make(doc, 'span', 'inline-block h-2.5 w-2.5 shrink-0 rounded-full');
  dot.style.setProperty('background-color', color);
  pill.appendChild(dot);
  pill.appendChild(make(doc, 'span', '', `${name} · ${countText}`));
  return pill;
};

/** The handle's square, unselected and selected (the selected vertex gets a dark ring). */
export const VERTEX_SQUARE_CLASS =
  'block h-3 w-3 rounded-[3px] border-2 border-white bg-[#F97316] shadow';
export const VERTEX_SQUARE_SELECTED_CLASS =
  'block h-3 w-3 rounded-[3px] border-2 border-white bg-[#F97316] shadow-[0_0_0_3px_#0f172a]';

/**
 * An orange vertex handle: 12 px visible inside a 32 px hit area (§8.8). Returns the square too, so
 * the canvas can mark the selected vertex in place — rebuilding the handle would take the keyboard
 * focus away from it.
 */
export const vertexHandleElement = (
  doc: DocLike,
  { selected }: { selected: boolean },
): { hit: ElementLike; square: ElementLike } => {
  const hit = make(doc, 'span', 'flex h-8 w-8 cursor-grab items-center justify-center');
  const square = make(doc, 'span', selected ? VERTEX_SQUARE_SELECTED_CLASS : VERTEX_SQUARE_CLASS);
  hit.appendChild(square);
  return { hit, square };
};

/** A blue midpoint diamond: drag it to add a vertex (§8.8). */
export const midpointHandleElement = (doc: DocLike): ElementLike => {
  const hit = make(doc, 'span', 'flex h-8 w-8 cursor-copy items-center justify-center');
  hit.appendChild(
    make(
      doc,
      'span',
      'block h-2.5 w-2.5 rotate-45 rounded-[2px] border-2 border-white bg-[#2563EB] opacity-90 shadow',
    ),
  );
  return hit;
};

/**
 * The temporary pin of a placement or a move: an orange ring with the machine's code above it, as
 * in the mockup (`Unlocated.dc.html`). Draggable (§8.8 `MovePinBar`).
 */
export const tempPinElement = (doc: DocLike, code: string): ElementLike => {
  const ring = make(
    doc,
    'span',
    'relative block h-[26px] w-[26px] cursor-grab rounded-full border-[3px] border-dashed border-[#F97316] bg-white/80 shadow-[0_0_0_6px_rgba(249,115,22,0.25)]',
  );
  const tag = make(
    doc,
    'span',
    'pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white',
    code,
  );
  tag.setAttribute('dir', 'ltr');
  ring.appendChild(tag);
  return ring;
};

/** «إغلاق الشكل» beside the first dot while the cursor is on it (§8.8). */
export const closeShapeElement = (doc: DocLike, text: string, dir: 'rtl' | 'ltr'): ElementLike => {
  const tip = make(
    doc,
    'span',
    'pointer-events-none whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-xs text-white',
    text,
  );
  tip.setAttribute('dir', dir);
  return tip;
};
