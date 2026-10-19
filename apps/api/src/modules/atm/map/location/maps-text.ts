// Reading ONE register cell — AP (`locationPlusCode`) or AV (`locationUrl`) — into location
// candidates (docs/12-planning/atm-map-zones.md §4.2).
//
// Nothing parsed these cells before. The order of preference is modelled on the web's operations
// link parser (`apps/web/src/modules/operations/lib/maps-link.ts`), whose central lesson holds here
// too: a Google place URL carries TWO points, the place's own (`!3d!4d`) and the map centre (`@`),
// and the centre is "never the first choice" — it can be hundreds of metres off. So a URL's
// reading is split into a PIN and a VIEWPORT, and a viewport alone is only a point for a person to
// confirm (DM-44).
//
// Coordinates are read from Google Maps URLs and `plus.codes` only; digits are never picked out of
// any other URL (DM-36). The cell text is P-class register data: nothing here logs it.
import {
  ATM_MAP_EARTH_RADIUS_METERS,
  EGYPT_BOUNDS,
  round6,
  type AtmMapLatLng,
} from '@ecms/contracts';
import { classifyPlusCode, decode } from './plus-code';

/** One thing a cell says about where the machine is, in the order it appears in the cell. */
export type LocationCandidate =
  | { kind: 'coordinates'; lat: number; lng: number; via: 'url' | 'text'; ambiguous: boolean }
  | { kind: 'plusCode'; code: string }
  | { kind: 'shortPlusCode'; code: string; urlReference: AtmMapLatLng | null }
  | { kind: 'viewport'; lat: number; lng: number }
  | { kind: 'shortLink'; url: string }
  | { kind: 'noCoordinates' }
  | { kind: 'invalidCoordinates' }
  | { kind: 'unreadable' };

// ── Distances and the Egypt box ─────────────────────────────────────────────────────────────────

/** Great-circle distance in metres, R = 6,371,008.8 m. */
export const haversineMeters = (a: AtmMapLatLng, b: AtmMapLatLng): number => {
  const toRadians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRadians;
  const dLng = (b.lng - a.lng) * toRadians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRadians) * Math.cos(b.lat * toRadians) * Math.sin(dLng / 2) ** 2;
  return 2 * ATM_MAP_EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** DM-35's box. It warns (`outsideEgypt`) and never blocks. */
export const insideEgypt = ({ lat, lng }: AtmMapLatLng): boolean =>
  lat >= EGYPT_BOUNDS.south &&
  lat <= EGYPT_BOUNDS.north &&
  lng >= EGYPT_BOUNDS.west &&
  lng <= EGYPT_BOUNDS.east;

// ── Hosts ───────────────────────────────────────────────────────────────────────────────────────

/** Lowercase, trailing dot removed — `MAPS.APP.GOO.GL.` is `maps.app.goo.gl`. */
export const normalizedHost = (url: URL): string => url.hostname.toLowerCase().replace(/\.$/, '');

const GOOGLE_HOST = /^(www\.|maps\.)?google\.(com|com\.eg)$/;

const isMapsPath = (pathname: string): boolean =>
  pathname === '/maps' || pathname.startsWith('/maps/');

/**
 * A Google Maps URL: a Google host with a `/maps` path, or `maps.google.com` with any path. A bare
 * "starts with /maps" test is not used: `/mapsXYZ` is not a Maps path.
 */
export const isGoogleMapsUrl = (url: URL): boolean => {
  const host = normalizedHost(url);
  return host === 'maps.google.com' || (GOOGLE_HOST.test(host) && isMapsPath(url.pathname));
};

/** `maps.app.goo.gl`, or `goo.gl/maps…` — `goo.gl/mapsXYZ` is a generic goo.gl link. */
export const isShortLinkUrl = (url: URL): boolean => {
  const host = normalizedHost(url);
  return host === 'maps.app.goo.gl' || (host === 'goo.gl' && isMapsPath(url.pathname));
};

// ── Shared patterns ─────────────────────────────────────────────────────────────────────────────

const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;
/** A whole value that is a pair, `loc:` prefix and a `(label)` suffix allowed (`?q=` style). */
const PARAM_PAIR = new RegExp(
  String.raw`^\s*(?:loc:)?(${NUMBER})\s*,\s*(${NUMBER})\s*(?:\(.*\))?$`,
);
/** A whole value that is nothing but a pair. */
const EXACT_PAIR = new RegExp(String.raw`^\s*(${NUMBER})\s*,\s*(${NUMBER})\s*$`);
const PLACE_PIN = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`, 'g');
const VIEWPORT = new RegExp(String.raw`/@(${NUMBER}),(${NUMBER})`);
/** The text form of a decimal pair: the whole field, Arabic comma accepted (`maps-link.ts:106-113`). */
const TEXT_PAIR = /^(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)$/;
const PLUS_CODE_TOKEN =
  /(?<![0-9A-Z])([2-9CFGHJMPQRVWX]{2,8}0*\+[2-9CFGHJMPQRVWX]{0,7})(?![0-9A-Z])/i;
/** One DMS part: 30°02'39.8"N (′ and ″ accepted). */
const DMS_PART = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]\s*([NSEW])`;
const DMS_PAIR = new RegExp(`${DMS_PART}[\\s,]*${DMS_PART}`, 'i');

const POINT_PARAMS = ['q', 'query', 'destination', 'daddr'] as const;
const VIEWPORT_PARAMS = ['ll', 'sll', 'center'] as const;

const pairOf = (match: RegExpMatchArray | null): AtmMapLatLng | null => {
  if (match === null) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

type DmsReading = { ok: true; point: AtmMapLatLng } | { ok: false } | null;

/**
 * A DMS pair (DM-36). Each part needs its hemisphere letter; N/S is the latitude and E/W the
 * longitude, in either order; S and W are negative. Minutes and seconds must be below 60.
 * `null` = no DMS pair at all; `{ ok: false }` = one that cannot be read.
 */
const readDms = (text: string): DmsReading => {
  const m = DMS_PAIR.exec(text);
  if (m === null) return null;
  const parts = [m.slice(1, 5), m.slice(5, 9)].map(([deg, min, sec, hemi]) => ({
    value: Number(deg) + Number(min) / 60 + Number(sec) / 3600,
    minutes: Number(min),
    seconds: Number(sec),
    hemi: (hemi ?? '').toUpperCase(),
  }));
  if (parts.some((p) => p.minutes >= 60 || p.seconds >= 60)) return { ok: false };
  const lat = parts.find((p) => p.hemi === 'N' || p.hemi === 'S');
  const lng = parts.find((p) => p.hemi === 'E' || p.hemi === 'W');
  if (lat === undefined || lng === undefined) return { ok: false };
  return {
    ok: true,
    point: {
      lat: lat.hemi === 'S' ? -lat.value : lat.value,
      lng: lng.hemi === 'W' ? -lng.value : lng.value,
    },
  };
};

/** A Plus Code token in free text, classified under §4.1 "Derivation use". */
const plusCodeIn = (text: string): LocationCandidate | null => {
  const m = PLUS_CODE_TOKEN.exec(text);
  if (m === null) return null;
  const code = (m[1] as string).toUpperCase();
  const kind = classifyPlusCode(code);
  if (kind === 'full') return { kind: 'plusCode', code };
  if (kind === 'short') return { kind: 'shortPlusCode', code, urlReference: null };
  return { kind: 'unreadable' };
};

// ── Google Maps URLs ────────────────────────────────────────────────────────────────────────────

/**
 * Path segments, decoded. A literal `+` becomes a space FIRST, then the segment is percent-decoded:
 * decoding first would turn `/place/26VP%2BQ7+Cairo` into «26VP Q7 Cairo» and lose the code.
 */
const decodedSegments = (pathname: string): string[] =>
  pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const spaced = segment.replace(/\+/g, ' ');
      try {
        return decodeURIComponent(spaced);
      } catch {
        return spaced;
      }
    });

/** What one Google Maps URL holds: a pin (the place's own point), a viewport, a short code. */
interface GoogleUrlReading {
  pin:
    | { kind: 'coordinates'; lat: number; lng: number; ambiguous: boolean }
    | { kind: 'plusCode'; code: string }
    | null;
  shortCode: string | null;
  viewport: AtmMapLatLng | null;
}

/** Two `!3d!4d` pairs further apart than this make the URL ambiguous (DM-44b). */
const AMBIGUOUS_PIN_METERS = 50;

const readGoogleUrl = (url: URL): GoogleUrlReading => {
  const segments = decodedSegments(url.pathname);
  const start = segments[0]?.toLowerCase() === 'maps' ? 1 : 0;
  const verb = segments[start]?.toLowerCase();
  const placeSegment = verb === 'place' || verb === 'search' ? (segments[start + 1] ?? null) : null;
  const q = url.searchParams.get('q');

  const readPin = (): GoogleUrlReading['pin'] => {
    // 1. Every `!3d<lat>!4d<lng>` pair in the URL; the first is the pin.
    const pins = [...url.href.matchAll(PLACE_PIN)]
      .map((m) => pairOf(m))
      .filter((p): p is AtmMapLatLng => p !== null);
    const first = pins[0];
    if (first !== undefined) {
      const ambiguous = pins.some((p) => haversineMeters(first, p) > AMBIGUOUS_PIN_METERS);
      return { kind: 'coordinates', ...first, ambiguous };
    }
    // 2. A point parameter whose WHOLE value is a pair (`?q=Building 26, 30 St` is not).
    for (const key of POINT_PARAMS) {
      const value = url.searchParams.get(key);
      const p = value === null ? null : pairOf(PARAM_PAIR.exec(value));
      if (p !== null) return { kind: 'coordinates', ...p, ambiguous: false };
    }
    // 3. A place/search segment that is EXACTLY a pair.
    const exact = placeSegment === null ? null : pairOf(EXACT_PAIR.exec(placeSegment));
    if (exact !== null) return { kind: 'coordinates', ...exact, ambiguous: false };
    // 4. A DMS pair in a place segment.
    if (verb === 'place' && placeSegment !== null) {
      const dms = readDms(placeSegment);
      if (dms?.ok === true) return { kind: 'coordinates', ...dms.point, ambiguous: false };
    }
    // 5. A full Plus Code in the place/search segment or in `q`.
    for (const text of [placeSegment, q]) {
      const found = text === null ? null : plusCodeIn(text);
      if (found?.kind === 'plusCode') return found;
    }
    return null;
  };

  const readShortCode = (): string | null => {
    for (const text of [placeSegment, q]) {
      const found = text === null ? null : plusCodeIn(text);
      if (found?.kind === 'shortPlusCode') return found.code;
    }
    return null;
  };

  const readViewport = (): AtmMapLatLng | null => {
    // Directions are not a place: their centre says nothing about a machine.
    if (verb === 'dir') return null;
    const centre = pairOf(VIEWPORT.exec(url.pathname));
    if (centre !== null) return centre;
    for (const key of VIEWPORT_PARAMS) {
      const value = url.searchParams.get(key);
      const p = value === null ? null : pairOf(EXACT_PAIR.exec(value));
      if (p !== null) return p;
    }
    return null;
  };

  return { pin: readPin(), shortCode: readShortCode(), viewport: readViewport() };
};

/**
 * One Google Maps URL as a candidate: its pin, else a short Plus Code (recovered later against the
 * URL's own viewport), else the viewport alone, else `noCoordinates`.
 */
export const coordinatesFromGoogleUrl = (url: URL): LocationCandidate => {
  const { pin, shortCode, viewport } = readGoogleUrl(url);
  if (pin !== null) return checked(pin.kind === 'plusCode' ? pin : { ...pin, via: 'url' });
  if (shortCode !== null) {
    return {
      kind: 'shortPlusCode',
      code: shortCode,
      urlReference: viewport === null || !onEarth(viewport) ? null : rounded(viewport),
    };
  }
  if (viewport !== null) return checked({ kind: 'viewport', ...viewport });
  return { kind: 'noCoordinates' };
};

/**
 * The point a redirect target gives the short-link resolver (§5.1 step 1): its pin, else its
 * viewport (`viewportOnly`), else null. A full Plus Code pin is its cell centre.
 */
export const pointFromGoogleUrl = (
  url: URL,
): { lat: number; lng: number; viewportOnly: boolean } | null => {
  const { pin, viewport } = readGoogleUrl(url);
  if (pin?.kind === 'plusCode') {
    const { lat, lng } = decode(pin.code);
    return { lat: round6(lat), lng: round6(lng), viewportOnly: false };
  }
  const point = pin ?? viewport;
  if (point === null || !onEarth(point)) return null;
  return { lat: round6(point.lat), lng: round6(point.lng), viewportOnly: pin === null };
};

// ── Range check ─────────────────────────────────────────────────────────────────────────────────

const onEarth = ({ lat, lng }: AtmMapLatLng): boolean =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const rounded = (p: AtmMapLatLng): AtmMapLatLng => ({ lat: round6(p.lat), lng: round6(p.lng) });

/** §4.2 step 3: off the Earth → `invalidCoordinates`; every value to 6 decimals. */
const checked = (candidate: LocationCandidate): LocationCandidate => {
  if (candidate.kind !== 'coordinates' && candidate.kind !== 'viewport') return candidate;
  if (!onEarth(candidate)) return { kind: 'invalidCoordinates' };
  return { ...candidate, lat: round6(candidate.lat), lng: round6(candidate.lng) };
};

// ── The cell ────────────────────────────────────────────────────────────────────────────────────

/**
 * A URL: a scheme and anything up to whitespace, or a scheme-less Google/short-link prefix at a
 * word boundary (not inside another host name or path).
 */
const URL_TOKEN =
  /https?:\/\/\S+|(?<![A-Za-z0-9_.\-/@])(?:maps\.app\.goo\.gl|maps\.google\.com|www\.google\.com|goo\.gl|google\.com)\/\S*/gi;
const TRAILING = /[)\]}>'"،.؛,!?]+$/;

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/**
 * A found token as a URL: `https://` prefixed when it had no scheme, and the punctuation stuck to
 * its end removed. A short-link token also ends at its first non-ASCII character: short-link
 * tokens are ASCII, and Arabic text stuck to the link is not part of it — that text goes back to
 * the cell's remainder (`leftover`). Other hosts keep non-ASCII characters, because a copied place
 * URL may carry the place name unencoded. Null when the token does not parse.
 */
const tokenUrl = (raw: string): { url: URL; text: string; leftover: string } | null => {
  let text = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(TRAILING, '');
  let url = parseUrl(text);
  if (url === null) return null;
  let leftover = '';
  if (isShortLinkUrl(url)) {
    const nonAscii = /[^\x20-\x7e]/.exec(text);
    if (nonAscii !== null) {
      leftover = text.slice(nonAscii.index);
      text = text.slice(0, nonAscii.index).replace(TRAILING, '');
      url = parseUrl(text);
      if (url === null) return null;
    }
  }
  return { url, text, leftover };
};

const plusCodesCandidate = (url: URL): LocationCandidate => {
  // There, `+` is the code's own: the segment is percent-decoded only.
  const first = url.pathname.split('/').find((segment) => segment !== '') ?? '';
  let code: string;
  try {
    code = decodeURIComponent(first).toUpperCase();
  } catch {
    return { kind: 'unreadable' };
  }
  const kind = classifyPlusCode(code);
  if (kind === 'full') return { kind: 'plusCode', code };
  if (kind === 'short') return { kind: 'shortPlusCode', code, urlReference: null };
  return { kind: 'unreadable' };
};

const readUrl = (raw: string): { candidate: LocationCandidate; leftover: string } => {
  const token = tokenUrl(raw);
  if (token === null) return { candidate: { kind: 'unreadable' }, leftover: '' };
  const { url, text, leftover } = token;
  let candidate: LocationCandidate;
  if (isShortLinkUrl(url)) candidate = { kind: 'shortLink', url: text };
  else if (isGoogleMapsUrl(url)) candidate = coordinatesFromGoogleUrl(url);
  else if (normalizedHost(url) === 'plus.codes') candidate = plusCodesCandidate(url);
  // Any other host: digits are never picked out of it (DM-36).
  else candidate = { kind: 'noCoordinates' };
  return { candidate, leftover };
};

const readPlainText = (text: string): LocationCandidate => {
  const pair = pairOf(TEXT_PAIR.exec(text));
  if (pair !== null)
    return checked({ kind: 'coordinates', ...pair, via: 'text', ambiguous: false });
  const dms = readDms(text);
  if (dms !== null) {
    return dms.ok
      ? checked({ kind: 'coordinates', ...dms.point, via: 'text', ambiguous: false })
      : { kind: 'unreadable' };
  }
  return plusCodeIn(text) ?? { kind: 'unreadable' };
};

/**
 * Every candidate one register cell holds, in the order they occur: each URL, and the text left
 * once the URLs are removed. An empty cell gives `[]`.
 */
export const readLocationText = (raw: string): LocationCandidate[] => {
  const cell = raw.trim();
  if (cell === '') return [];
  const found: { at: number; candidate: LocationCandidate }[] = [];
  let remainder = '';
  let last = 0;
  for (const m of cell.matchAll(URL_TOKEN)) {
    const at = m.index;
    const { candidate, leftover } = readUrl(m[0]);
    remainder += cell.slice(last, at) + ' '.repeat(m[0].length - leftover.length) + leftover;
    last = at + m[0].length;
    found.push({ at, candidate });
  }
  remainder += cell.slice(last);
  const text = remainder.trim();
  if (text !== '') found.push({ at: remainder.search(/\S/), candidate: readPlainText(text) });
  return found.sort((a, b) => a.at - b.at).map((f) => f.candidate);
};
