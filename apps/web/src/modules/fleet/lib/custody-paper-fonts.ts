// The custody papers' fonts — his Windows fonts by name, and nothing shipped.
//
// His papers are Calibri, Segoe UI (Calibri's Arabic), Arial and Times New Roman: Windows fonts,
// used as they are on the office's PCs, which is where the papers are printed. They come FIRST in
// every stack, exactly as his files name them. No font file is bundled: on a machine without them
// the Arabic falls to what that machine has — the faces below, which only ALIAS fonts already
// installed (`local()`), with his metrics set on them (`size-adjust`, the overrides) so a Linux box
// draws his rows the size Windows does; then the Arabic faces phones and Linux commonly carry
// (Noto Naskh Arabic, Noto Sans Arabic, Amiri), then the generic family. Every face is limited to
// the Arabic blocks (`unicode-range`), and sits after his Windows font in the stack, so Windows
// never uses one.
//
// ONE table (`PAPER_FACES`) feeds both the print document's `@font-face` rules (`PAPER_FONT_CSS`,
// written once into its <head>) and the app's FontFace registration (`paperFontsReady`), so the
// preview and the printed page draw with the same faces. Nothing happens at import time.

export const PAPER_UNICODE_RANGE = 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF';

export interface PaperFace {
  family: string;
  /** `local(…)` sources only — installed fonts, never a file. */
  src: string;
  weight: string;
  sizeAdjust?: string;
  ascentOverride?: string;
  descentOverride?: string;
  lineGapOverride?: string;
}

const NOTO_SANS_BOLD = 'local("Noto Sans Arabic Bold"),local("NotoSansArabic-Bold")';
const NOTO_SANS =
  'local("Noto Sans Arabic"),local("Noto Sans Arabic Regular"),local("NotoSansArabic-Regular")';
const DEJAVU_SANS_BOLD = 'local("DejaVu Sans Bold"),local("DejaVuSans-Bold")';
const DEJAVU_SANS = 'local("DejaVu Sans"),local("DejaVuSans")';
const FREE_SERIF_BOLD = 'local("FreeSerif Bold"),local("FreeSerifBold")';
const FREE_SERIF = 'local("FreeSerif")';

/**
 * (C) «Calibri» cells — Arabic in Windows' fallback for Calibri (Segoe UI); here Noto Sans Arabic
 * where installed, else DejaVu Sans, each at Segoe UI's size. (A) «Arial» cells — a regular Arial cell takes FreeSerif
 * Bold's dark drawing, a bold one regular FreeSerif a little larger. (T) small regular Arial
 * labels: plain FreeSerif. (K) the fuel sheet's Arabic table cells: plain FreeSerif, its baseline
 * set where Arial's falls (Arial's ascent .905 / descent .212, over the size-adjust). (H) the fuel
 * sheet's company and «إداره الحركه» lines: FreeSerif Bold, smaller. The letters: FreeSerif for
 * Times New Roman's Arabic, 5.5% larger for the settle letter's body (`… Letter C`).
 */
export const PAPER_FACES: readonly PaperFace[] = [
  { family: 'ECMS Paper Sans Arabic', src: NOTO_SANS_BOLD, weight: '700', sizeAdjust: '74%' },
  { family: 'ECMS Paper Sans Arabic', src: NOTO_SANS, weight: '400', sizeAdjust: '74%' },
  // Where Noto Sans Arabic is missing too (a bare Linux box): DejaVu Sans' Arabic, brought to the
  // same widths (measured against Noto Sans Arabic at 74%: 0.66 bold, 0.71 regular).
  { family: 'ECMS Paper Sans Arabic Alt', src: DEJAVU_SANS_BOLD, weight: '700', sizeAdjust: '66%' },
  { family: 'ECMS Paper Sans Arabic Alt', src: DEJAVU_SANS, weight: '400', sizeAdjust: '71%' },
  { family: 'ECMS Paper Naskh', src: FREE_SERIF_BOLD, weight: '100 900', sizeAdjust: '83.5%' },
  { family: 'ECMS Paper Naskh Bold', src: FREE_SERIF, weight: '400', sizeAdjust: '90%' },
  { family: 'ECMS Paper Naskh Thin', src: FREE_SERIF, weight: '100 900', sizeAdjust: '83%' },
  {
    family: 'ECMS Paper Naskh Cell',
    src: FREE_SERIF,
    weight: '100 900',
    sizeAdjust: '95%',
    ascentOverride: '95.3%',
    descentOverride: '22.3%',
    lineGapOverride: '0%',
  },
  { family: 'ECMS Paper Naskh Top', src: FREE_SERIF_BOLD, weight: '100 900', sizeAdjust: '78%' },
  { family: 'ECMS Paper Letter', src: FREE_SERIF, weight: '400' },
  { family: 'ECMS Paper Letter C', src: FREE_SERIF, weight: '400', sizeAdjust: '105.5%' },
];

const faceCss = (face: PaperFace): string =>
  [
    `font-family:"${face.family}"`,
    `src:${face.src}`,
    `font-weight:${face.weight}`,
    ...(face.sizeAdjust === undefined ? [] : [`size-adjust:${face.sizeAdjust}`]),
    ...(face.ascentOverride === undefined ? [] : [`ascent-override:${face.ascentOverride}`]),
    ...(face.descentOverride === undefined ? [] : [`descent-override:${face.descentOverride}`]),
    ...(face.lineGapOverride === undefined ? [] : [`line-gap-override:${face.lineGapOverride}`]),
    `unicode-range:${PAPER_UNICODE_RANGE}`,
  ].join(';');

/** The `@font-face` rules — for the print document's <head> only, once. */
export const PAPER_FONT_CSS = PAPER_FACES.map((face) => `@font-face{${faceCss(face)}}`).join('\n');

/** Arabic faces phones and Linux commonly carry, after his fonts and the aliases above. */
const NASKH_FALLBACK = '"Noto Naskh Arabic","Noto Sans Arabic",Amiri';
/** The same, sans first — for the «Calibri» cells, whose Arabic is Segoe UI's (a sans). */
const SANS_FALLBACK = '"Noto Sans Arabic","Noto Naskh Arabic",Amiri';

const arialStack = (alias: string): string =>
  `Arial,"${alias}","Liberation Sans",FreeSerif,${NASKH_FALLBACK},sans-serif`;

/** The CSS font stacks the sheets use — his Windows font first, every time. */
export const STACK = {
  /** His «Calibri» cells. Carlito before the fallbacks: it is Calibri's metrics for the digits. */
  cal: `Calibri,"Segoe UI","ECMS Paper Sans Arabic","ECMS Paper Sans Arabic Alt",Carlito,${SANS_FALLBACK},"DejaVu Sans",sans-serif`,
  ari: arialStack('ECMS Paper Naskh'),
  ariB: arialStack('ECMS Paper Naskh Bold'),
  ariThin: arialStack('ECMS Paper Naskh Thin'),
  ariCell: arialStack('ECMS Paper Naskh Cell'),
  ariTop: arialStack('ECMS Paper Naskh Top'),
  /** The letters' Times New Roman (the theme's «majorBidi»). */
  tnr: `"Times New Roman","ECMS Paper Letter","Liberation Serif",${NASKH_FALLBACK},serif`,
  /** The letters' Arial: the letterhead and the general manager. */
  arial: `Arial,"ECMS Paper Letter","Liberation Sans",${NASKH_FALLBACK},sans-serif`,
  /** The settle letter's body. */
  tnrC: `"Times New Roman","ECMS Paper Letter C","Liberation Serif",${NASKH_FALLBACK},serif`,
  /** The tatweel between the parts of a period date, drawn on the baseline. */
  tatweel: `"Times New Roman","DejaVu Sans",${NASKH_FALLBACK},sans-serif`,
} as const;

let loading: Promise<void> | null = null;
let loaded = false;

/**
 * Registers the faces with the app's document, so the previews draw with them and a canvas can
 * measure with them (the maintenance «البيان» shrink-to-fit). Idempotent; resolves at once where
 * there is no document (the node specs). A face whose font is not installed simply fails to load —
 * the stack moves on — so this never rejects.
 */
export const paperFontsReady = (): Promise<void> => {
  if (loading !== null) return loading;
  if (
    typeof document === 'undefined' ||
    typeof FontFace === 'undefined' ||
    !('fonts' in document) ||
    typeof document.fonts.add !== 'function'
  ) {
    loaded = true;
    loading = Promise.resolve();
    return loading;
  }
  const loads = PAPER_FACES.map((face) => {
    // `sizeAdjust` is a FontFace descriptor (Chrome 92+) the DOM typings do not list yet.
    const descriptors: FontFaceDescriptors & { sizeAdjust?: string } = {
      weight: face.weight,
      unicodeRange: PAPER_UNICODE_RANGE,
      ...(face.sizeAdjust === undefined ? {} : { sizeAdjust: face.sizeAdjust }),
      ...(face.ascentOverride === undefined ? {} : { ascentOverride: face.ascentOverride }),
      ...(face.descentOverride === undefined ? {} : { descentOverride: face.descentOverride }),
      ...(face.lineGapOverride === undefined ? {} : { lineGapOverride: face.lineGapOverride }),
    };
    const font = new FontFace(face.family, face.src, descriptors);
    document.fonts.add(font);
    return font.load();
  });
  loading = Promise.allSettled(loads).then(() => {
    loaded = true;
  });
  return loading;
};

let ruler: CanvasRenderingContext2D | null | undefined;

/**
 * A line's width in CSS px in a canvas `font` — null where it cannot be measured (yet): before the
 * faces are registered, or with no DOM. The caller then estimates.
 */
export const measureText = (words: string, font: string): number | null => {
  if (!loaded || typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null;
  }
  if (ruler === undefined) ruler = document.createElement('canvas').getContext('2d');
  if (ruler === null) return null;
  ruler.font = font;
  return ruler.measureText(words).width;
};
