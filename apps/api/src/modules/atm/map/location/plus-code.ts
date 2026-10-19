// Open Location Code ("Plus Code"), our own implementation (docs/12-planning/atm-map-zones.md §4.1).
//
// The register's AP column holds Plus Codes typed or pasted by people: 18 full codes and 163 short
// ones in the workbook (counts only). No plus-code library is installed and none is added (GM-19).
//
// EXACT INTEGER ARITHMETIC. A Plus Code is a cell on a grid; deciding which cell a point falls in
// is a floor, and a floating-point floor is wrong on cell edges: (22.226405, 36.922625) is
// `7GJR6WGF+H3`, because 216.922625 × 8,192,000 is exactly 1,777,030,144, while the float form
// gives `…+H2`. So the point is rounded to 6 decimals (the precision every stored point carries)
// and everything after that is an integer:
//   latitude  in units of 1/25,000,000°  (pair precision 1/8000° × grid 5⁵ rows),
//   longitude in units of 1/8,192,000°   (1/8000° × grid 4⁵ columns).
// Both stay below 2⁵³. Decoding accumulates the same integers and divides once at the end.

export const PLUS_CODE_ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_INDEX = 8;
const PADDING = '0';
const PAIR_DIGITS = 10;
const MAX_DIGITS = 15;
const GRID_DIGITS = MAX_DIGITS - PAIR_DIGITS;

const LAT_UNITS_PER_DEGREE = 25_000_000;
const LNG_UNITS_PER_DEGREE = 8_192_000;
/** One step of the fifth (last) pair: 1/8000° in each axis's units. */
const LAT_PAIR5_UNITS = 3125;
const LNG_PAIR5_UNITS = 1024;
const LAT_SPAN_UNITS = 180 * LAT_UNITS_PER_DEGREE;
const LNG_SPAN_UNITS = 360 * LNG_UNITS_PER_DEGREE;

const valueOf = (ch: string): number => PLUS_CODE_ALPHABET.indexOf(ch);

/** A decoded cell: its edges, and its centre (`lat`, `lng`). */
export interface PlusCodeArea {
  south: number;
  west: number;
  north: number;
  east: number;
  lat: number;
  lng: number;
}

/** The cell in integer units: its south-west corner and its size. */
interface UnitCell {
  south: number;
  west: number;
  latSize: number;
  lngSize: number;
}

// ── Validity and classification ─────────────────────────────────────────────────────────────────

/**
 * The OLC validity rules, case-insensitively:
 *   · exactly one `+`, at an even index from 2 to 8;
 *   · only alphabet characters, `0` and `+`;
 *   · padding `0`s only before `+`, never at index 0, starting at an even index, contiguous, and
 *     with nothing after `+` when the code is padded;
 *   · exactly one character after `+` is invalid.
 */
export const isValidCode = (code: string): boolean => {
  const s = code.toUpperCase();
  const plus = s.indexOf(SEPARATOR);
  if (plus === -1 || plus !== s.lastIndexOf(SEPARATOR)) return false;
  if (plus % 2 !== 0 || plus < 2 || plus > SEPARATOR_INDEX) return false;
  for (const ch of s) {
    if (ch !== SEPARATOR && ch !== PADDING && !PLUS_CODE_ALPHABET.includes(ch)) return false;
  }
  const firstPad = s.indexOf(PADDING);
  if (firstPad !== -1) {
    if (firstPad === 0 || firstPad % 2 !== 0 || firstPad > plus) return false;
    if (!/^0+$/.test(s.slice(firstPad, plus))) return false;
    if (s.length > plus + 1) return false;
  }
  return s.length - plus - 1 !== 1;
};

const isPadded = (code: string): boolean => code.includes(PADDING);

/**
 * A full code: valid, `+` at index 8, first character's value ≤ 8 (latitude < 180°) and second
 * character's value ≤ 17 (longitude < 360°).
 */
export const isFull = (code: string): boolean => {
  if (!isValidCode(code)) return false;
  const s = code.toUpperCase();
  if (s.indexOf(SEPARATOR) !== SEPARATOR_INDEX) return false;
  return valueOf(s[0] as string) <= 8 && valueOf(s[1] as string) <= 17;
};

/** A short code: valid, `+` before index 8, and never padded. */
export const isShort = (code: string): boolean => {
  if (!isValidCode(code)) return false;
  return code.indexOf(SEPARATOR) < SEPARATOR_INDEX && !isPadded(code);
};

/** The code's digits, separator and padding removed. */
const digitsOf = (code: string): string => code.toUpperCase().replace(/[+0]/g, '');

/**
 * What a code means for a machine's location (§4.1 "Derivation use"). A full code needs at least
 * 10 digits: a padded code, or one with nothing after `+`, is a cell of 0.0025° (≈ 275 m) or more
 * and does not give a machine's point. A short code recovers into a full code of its own length
 * plus the prefix, so the same floor applies: a short code with nothing after `+` is `unreadable`.
 * A valid code that is neither (`WG2H26VP+Q7`: first value 18 > 8) is `unreadable`.
 */
export const classifyPlusCode = (code: string): 'full' | 'short' | 'unreadable' => {
  if (isFull(code)) return digitsOf(code).length >= PAIR_DIGITS ? 'full' : 'unreadable';
  if (isShort(code)) {
    const s = code.toUpperCase();
    return s.length - s.indexOf(SEPARATOR) - 1 >= 2 ? 'short' : 'unreadable';
  }
  return 'unreadable';
};

// ── Encoding ────────────────────────────────────────────────────────────────────────────────────

/** A 6-decimal point as integer units; latitude clipped to [-90, 90), longitude wrapped to [-180, 180). */
const toUnits = (lat: number, lng: number): { latInt: number; lngInt: number } => {
  const latMicro = Math.max(-90_000_000, Math.min(90_000_000, Math.round(lat * 1e6)));
  let latInt = (latMicro + 90_000_000) * 25;
  if (latInt >= LAT_SPAN_UNITS) latInt = LAT_SPAN_UNITS - 1;
  const lngMicro =
    (((Math.round(lng * 1e6) + 180_000_000) % 360_000_000) + 360_000_000) % 360_000_000;
  const scaled = lngMicro * 8192;
  const lngInt = (scaled - (scaled % 1000)) / 1000;
  return { latInt, lngInt };
};

const encodeUnits = (latUnits: number, lngUnits: number, length: number): string => {
  let latInt = latUnits;
  let lngInt = lngUnits;
  let grid = '';
  for (let i = 0; i < GRID_DIGITS; i += 1) {
    const row = latInt % 5;
    const col = lngInt % 4;
    grid = (PLUS_CODE_ALPHABET[row * 4 + col] as string) + grid;
    latInt = Math.floor(latInt / 5);
    lngInt = Math.floor(lngInt / 4);
  }
  let pairs = '';
  for (let i = 0; i < PAIR_DIGITS / 2; i += 1) {
    pairs =
      (PLUS_CODE_ALPHABET[latInt % 20] as string) +
      (PLUS_CODE_ALPHABET[lngInt % 20] as string) +
      pairs;
    latInt = Math.floor(latInt / 20);
    lngInt = Math.floor(lngInt / 20);
  }
  const digits = (pairs + grid).slice(0, length);
  if (length < SEPARATOR_INDEX) {
    return digits + PADDING.repeat(SEPARATOR_INDEX - length) + SEPARATOR;
  }
  return digits.slice(0, SEPARATOR_INDEX) + SEPARATOR + digits.slice(SEPARATOR_INDEX);
};

const validLength = (length: number): boolean =>
  Number.isInteger(length) &&
  ((length >= 2 && length <= SEPARATOR_INDEX && length % 2 === 0) ||
    (length >= PAIR_DIGITS && length <= MAX_DIGITS));

/**
 * The code of the cell containing (lat, lng). Lengths 2–8 (even, padded with `0` up to `+`), 10,
 * and 11–15 (grid digits).
 */
export const encode = (lat: number, lng: number, length = PAIR_DIGITS): string => {
  if (!validLength(length)) throw new RangeError(`invalid Plus Code length ${String(length)}`);
  const { latInt, lngInt } = toUnits(lat, lng);
  return encodeUnits(latInt, lngInt, length);
};

// ── Decoding ────────────────────────────────────────────────────────────────────────────────────

const decodeUnits = (code: string): UnitCell => {
  const digits = digitsOf(code).slice(0, MAX_DIGITS);
  let south = 0;
  let west = 0;
  let latSize = LAT_SPAN_UNITS;
  let lngSize = LNG_SPAN_UNITS;
  for (let i = 0; i < Math.min(digits.length, PAIR_DIGITS); i += 1) {
    const place = 20 ** (4 - Math.floor(i / 2));
    const value = valueOf(digits[i] as string);
    if (i % 2 === 0) {
      latSize = place * LAT_PAIR5_UNITS;
      south += value * latSize;
    } else {
      lngSize = place * LNG_PAIR5_UNITS;
      west += value * lngSize;
    }
  }
  for (let i = PAIR_DIGITS; i < digits.length; i += 1) {
    const value = valueOf(digits[i] as string);
    latSize = 5 ** (MAX_DIGITS - 1 - i);
    lngSize = 4 ** (MAX_DIGITS - 1 - i);
    south += Math.floor(value / 4) * latSize;
    west += (value % 4) * lngSize;
  }
  return { south, west, latSize, lngSize };
};

const areaOf = (cell: UnitCell): PlusCodeArea => {
  const latOrigin = 90 * LAT_UNITS_PER_DEGREE;
  const lngOrigin = 180 * LNG_UNITS_PER_DEGREE;
  return {
    south: (cell.south - latOrigin) / LAT_UNITS_PER_DEGREE,
    west: (cell.west - lngOrigin) / LNG_UNITS_PER_DEGREE,
    north: (cell.south + cell.latSize - latOrigin) / LAT_UNITS_PER_DEGREE,
    east: (cell.west + cell.lngSize - lngOrigin) / LNG_UNITS_PER_DEGREE,
    lat: (2 * cell.south + cell.latSize - 2 * latOrigin) / (2 * LAT_UNITS_PER_DEGREE),
    lng: (2 * cell.west + cell.lngSize - 2 * lngOrigin) / (2 * LNG_UNITS_PER_DEGREE),
  };
};

/** The cell of a FULL code; throws on anything else. */
export const decode = (code: string): PlusCodeArea => {
  if (!isFull(code)) throw new RangeError('not a full Plus Code');
  return areaOf(decodeUnits(code));
};

// ── Short codes ─────────────────────────────────────────────────────────────────────────────────

/**
 * The full code nearest the reference that ends in `shortCode` (the OLC "recover nearest"). The
 * recovered point always lies within half a cell of the reference on each axis — ±10°, ±0.5° or
 * ±0.025° for 6, 4 or 2 characters before `+` — whatever the true point (§4.1 table). The
 * comparisons are done on integers scaled to a common unit, so a point exactly on the window's
 * edge is decided exactly.
 */
export const recoverNearest = (
  shortCode: string,
  refLat: number,
  refLng: number,
): { code: string; lat: number; lng: number } => {
  if (!isShort(shortCode)) throw new RangeError('not a short Plus Code');
  const short = shortCode.toUpperCase();
  const pad = SEPARATOR_INDEX - short.indexOf(SEPARATOR);
  const prefix = encode(refLat, refLng).slice(0, pad);
  const cell = decodeUnits(prefix + short);
  const length = digitsOf(prefix + short).length;

  // Latitude: units of 1/25,000,000°, exact for a 6-decimal reference.
  const latResolution = 20 ** (2 - pad / 2) * LAT_UNITS_PER_DEGREE;
  const refLatUnits = (Math.round(refLat * 1e6) + 90_000_000) * 25;
  const centreLat2 = 2 * cell.south + cell.latSize;
  let south = cell.south;
  if (2 * refLatUnits + latResolution < centreLat2 && centreLat2 - 2 * latResolution >= 0) {
    south -= latResolution;
  } else if (
    2 * refLatUnits - latResolution > centreLat2 &&
    centreLat2 + 2 * latResolution <= 2 * LAT_SPAN_UNITS
  ) {
    south += latResolution;
  }

  // Longitude: compared in 1/8,192,000,000° (micro-degrees × 8192 = units × 1000), exact.
  const lngResolution = 20 ** (2 - pad / 2) * LNG_UNITS_PER_DEGREE;
  const refLngScaled = (Math.round(refLng * 1e6) + 180_000_000) * 8192;
  const centreLng2Scaled = (2 * cell.west + cell.lngSize) * 1000;
  let west = cell.west;
  if (2 * refLngScaled + lngResolution * 1000 < centreLng2Scaled) {
    west -= lngResolution;
  } else if (2 * refLngScaled - lngResolution * 1000 > centreLng2Scaled) {
    west += lngResolution;
  }
  west = ((west % LNG_SPAN_UNITS) + LNG_SPAN_UNITS) % LNG_SPAN_UNITS;

  const code = encodeUnits(south, west, length);
  const area = areaOf(decodeUnits(code));
  return { code, lat: area.lat, lng: area.lng };
};
