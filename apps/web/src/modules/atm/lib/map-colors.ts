// The machine map's colours (docs/12-planning/atm-map-zones.md §8.5, §8.9): the twelve zone colours
// of the approved mockup, the bank colours of the Data Report, and the two contrast rules that
// decide which of them get a dark ring.
//
// Grey `#6b7280` is reserved for «بلا قطاع» / «بنك غير محدد» and red for errors; no palette colour is
// either, so a grey dot always means "no zone" and never "a grey zone".
import {
  ATM_BANK_REPORT_COLORS,
  ATM_MAP_ZONE_PALETTE,
  type AtmBankCode,
  type AtmMapZonePaletteKey,
} from '@ecms/contracts';
import { boxOf, boxesMeet, type LatLngBox } from './map-geometry';

/** The map's own background (OSM land), which every contrast here is measured against. */
export const MAP_BACKGROUND = '#f2efe9';
/** «بلا قطاع» and «بنك غير محدد». */
export const NO_ZONE_GREY = '#6b7280';
/** The casing of a light zone outline and the ring of a pale bank's dot. */
export const CASING_INK = '#1f2937';

/** The palette with the i18n key of each colour's name (the swatch's `aria-label`). */
export const ZONE_PALETTE: readonly {
  key: AtmMapZonePaletteKey;
  hex: string;
  cased: boolean;
  nameKey: string;
}[] = ATM_MAP_ZONE_PALETTE.map((colour) => ({
  ...colour,
  nameKey: `atm.map.palette.${colour.key}`,
}));

/**
 * The colour a new zone is offered (the «مقترح» swatch): the first palette colour the branch does not
 * use yet; when all twelve are used, the least used one that no zone touching the new one uses;
 * ties go to palette order. `newZoneBox` is null while nothing is drawn yet — then nothing touches.
 */
export const suggestColor = (
  draft: readonly { color: string; points: readonly { lat: number; lng: number }[] }[],
  newZoneBox: LatLngBox | null,
): string => {
  const uses = new Map<string, number>();
  for (const zone of draft) {
    const hex = zone.color.toLowerCase();
    uses.set(hex, (uses.get(hex) ?? 0) + 1);
  }
  const unused = ZONE_PALETTE.find((colour) => !uses.has(colour.hex));
  if (unused !== undefined) return unused.hex;

  const touching = new Set(
    newZoneBox === null
      ? []
      : draft
          .filter((zone) => zone.points.length > 0 && boxesMeet(boxOf(zone.points), newZoneBox))
          .map((zone) => zone.color.toLowerCase()),
  );
  const leastUsed = (candidates: readonly (typeof ZONE_PALETTE)[number][]) =>
    candidates.reduce<(typeof ZONE_PALETTE)[number] | null>(
      (best, colour) =>
        best === null || (uses.get(colour.hex) ?? 0) < (uses.get(best.hex) ?? 0) ? colour : best,
      null,
    );
  const free = ZONE_PALETTE.filter((colour) => !touching.has(colour.hex));
  return (leastUsed(free) ?? leastUsed(ZONE_PALETTE) ?? (ZONE_PALETTE[0] as { hex: string })).hex;
};

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
const luminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const channel = (offset: number): number => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
};

/** The WCAG contrast ratio of two colours (1…21). */
export const contrastRatio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** A colour under 3:1 against the map gets a dark casing (non-text contrast, WCAG 1.4.11). */
export const needsCasing = (hex: string): boolean => contrastRatio(hex, MAP_BACKGROUND) < 3;

/** A machine's dot in colour-by-bank: the Data Report's colour, or grey without a bank (DM-17). */
export const bankColor = (code: AtmBankCode | null): string =>
  code === null ? NO_ZONE_GREY : ATM_BANK_REPORT_COLORS[code];

/** The three pale bank colours, whose dots get a dark ring (§8.9). */
export const paleBank = (code: AtmBankCode | null): boolean =>
  code === 'CIB' || code === 'HDB' || code === 'BRK';
