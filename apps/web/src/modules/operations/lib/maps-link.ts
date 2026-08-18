// Reading a branch's coordinates out of a Google Maps URL.
//
// WHY PARSE AT ALL. Nobody types latitude and longitude. What an operations clerk actually has is
// the branch open in Google Maps on the phone next to them, and a Share button. So the field takes
// what Share produces — and Share produces half a dozen different URL shapes.
//
// WHAT IS STORED IS THE POINT, NEVER THE URL. `OperationsLocation.coordinates` is the domain value
// (design §17.4) and the contract already has it; a pasted URL is an input affordance, not data. A
// stored link would also rot — it can be shortened, localized or revoked — while a point regenerates
// a working link forever, which is what `mapsUrl` below does for the captain.
//
// Pure and React-free, because every one of these shapes is a case worth pinning in a test.

/** A latitude/longitude pair, exactly as `OperationsLocationSchema` records it. */
export interface MapsCoordinates {
  lat: number;
  lng: number;
}

/**
 * Why a paste did not yield a point. Three distinct answers because they need three distinct
 * things from the user — "invalid link" tells them nothing about which one they are looking at.
 */
export type MapsLinkFailure =
  /** Nothing to read yet. */
  | 'empty'
  /**
   * A `maps.app.goo.gl` / `goo.gl/maps` short link. It carries NO coordinates at all — the point
   * lives behind a redirect only Google can resolve, and the browser cannot follow it from here
   * (cross-origin). The user opens it and copies the full URL; that is a real instruction, which
   * is why it is not lumped in with "no coordinates".
   */
  | 'shortLink'
  /** A Maps URL for a NAMED place with no point in it — e.g. `?q=Cairo+Tower`. */
  | 'noCoordinates'
  /** A point was read but is not on Earth — a truncated paste, usually. */
  | 'outOfRange';

export type MapsLinkResult =
  | { ok: true; coordinates: MapsCoordinates }
  | { ok: false; reason: MapsLinkFailure };

const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(`(${NUMBER})\\s*,\\s*(${NUMBER})`);

/**
 * The place's OWN point, from the `data=` blob: `!3d<lat>!4d<lng>`.
 *
 * Tried first and on purpose. A `/place/` URL carries two different points — this one, and the
 * `@lat,lng` that is merely where the MAP was centred when the link was made. Reading the centre
 * for a place can be off by hundreds of metres, which for a driver is the wrong side of a road.
 */
const PLACE_POINT = new RegExp(`!3d(${NUMBER})!4d(${NUMBER})`);

/** `/maps/@30.04,31.23,15z` — the map centre. The fallback, never the first choice. */
const MAP_CENTRE = new RegExp(`/@(${NUMBER}),(${NUMBER})`);

/** Parameters that carry a point when they carry one at all. `loc:` is the legacy `?q=` prefix. */
const POINT_PARAMS = ['q', 'query', 'destination', 'center', 'll', 'sll', 'daddr'];

const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co'];

const onEarth = ({ lat, lng }: MapsCoordinates): boolean =>
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** Round-trip a matched pair into numbers, or null when either side is not a number. */
const pair = (rawLat: string, rawLng: string): MapsCoordinates | null => {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const fromParams = (input: string): MapsCoordinates | null => {
  const query = input.slice(input.indexOf('?') + 1);
  if (!input.includes('?')) return null;
  const params = new URLSearchParams(query);
  for (const key of POINT_PARAMS) {
    const value = params.get(key);
    if (value === null) continue;
    // `?q=loc:30.04,31.23` — the prefix is Google's, not part of the number.
    const match = PAIR.exec(value.startsWith('loc:') ? value.slice(4) : value);
    const found = match === null ? null : pair(match[1] ?? '', match[2] ?? '');
    if (found !== null) return found;
  }
  return null;
};

/**
 * A Google Maps URL — or a bare `30.0444, 31.2357`, since somebody who already has the numbers
 * should not have to go and find a link to put them in.
 */
export const parseMapsLink = (raw: string): MapsLinkResult => {
  const input = raw.trim();
  if (input === '') return { ok: false, reason: 'empty' };

  if (SHORT_HOSTS.some((host) => input.includes(`${host}/`))) {
    return { ok: false, reason: 'shortLink' };
  }

  const place = PLACE_POINT.exec(input);
  const centre = MAP_CENTRE.exec(input);
  const found =
    (place === null ? null : pair(place[1] ?? '', place[2] ?? '')) ??
    fromParams(input) ??
    (centre === null ? null : pair(centre[1] ?? '', centre[2] ?? '')) ??
    // Last: the whole field as a bare pair. Only when it is nothing BUT a pair, so a URL that
    // reached here — having failed every shape above — is not mined for stray digits.
    (/^[\s\d.,-]+$/.test(input)
      ? (() => {
          const match = PAIR.exec(input);
          return match === null ? null : pair(match[1] ?? '', match[2] ?? '');
        })()
      : null);

  if (found === null) return { ok: false, reason: 'noCoordinates' };
  if (!onEarth(found)) return { ok: false, reason: 'outOfRange' };
  return { ok: true, coordinates: found };
};

/**
 * The link to hand a human for a stored point — for the clerk to check what they just saved, and
 * for the captain's screen to open.
 *
 * `?q=` rather than a directions URL: this answers "where is this branch", and the driver's own app
 * takes it from there. Generated from the point every time, so it cannot go stale.
 */
export const mapsUrl = ({ lat, lng }: MapsCoordinates): string =>
  `https://www.google.com/maps?q=${String(lat)},${String(lng)}`;
