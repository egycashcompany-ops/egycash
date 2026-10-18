// Where the map's links go (docs/12-planning/atm-map-zones.md §8.5, §8.8).
//
// There is no page that opens one register entry (GM-10), so «فتح في سجل الماكينات» searches the
// register for the machine's code (`RegisterPage.tsx` reads `q`). The Google Maps link is the one
// operations hands out for a branch, promoted to `shared/lib/google-maps-url.ts`.
export { googleMapsUrl } from '../../../shared/lib/google-maps-url';

export const registerSearchUrl = (code: string): string =>
  `/atm/register?q=${encodeURIComponent(code)}`;

/** S1 → S5, carrying the branch the map shows (S5 validates it against its own context). */
export const unlocatedMachinesUrl = (branch: string | null): string =>
  branch === null
    ? '/atm/map/unlocated'
    : `/atm/map/unlocated?branch=${encodeURIComponent(branch)}`;

/** S5 → S1 («رجوع إلى الخريطة»), carrying the current branch. */
export const machineMapUrl = (branch: string | null): string =>
  branch === null ? '/atm/map' : `/atm/map?branch=${encodeURIComponent(branch)}`;

/**
 * «فتح الرابط الأصلي» is offered only for an http(s) link: the register cell is free text, and a
 * `javascript:` or `data:` value in it must never become an href.
 */
export const originalLinkHref = (text: string | null): string | null => {
  if (text === null) return null;
  const value = text.trim();
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};
