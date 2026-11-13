// «كورولا 1» against the registry — one car, however its code was stored.
//
// The filter's codes arrive parsed by `splitVehicleCodeList`, which now keeps a code holding a
// space whole («كورولا 1», «MG 2», «بيجو 5008») and writes the space as ONE space. The registry
// was not written by that parser: the go-live sheet carries «فورتشنر 2 » with a trailing space, a
// clerk can type a double space, and a Latin code may be stored «MG 2» and asked for as «mg 2».
// An exact `$in` matched none of those, so a car picked from the list could come back empty.
//
// So every place that matches a filter's codes against stored codes matches them HERE, by one
// rule: the same words in the same order, whitespace between and around them read as one space,
// Latin case ignored. Stored data is not touched — the comparison is what changes.
//
// Each code is an anchored, escaped pattern (`^␣*كورولا␣+1␣*$`, case-insensitive, `␣` the
// whitespace class below), so «كورولا 1» never matches «كورولا 10» and a `.` or `+` in a code is
// that character. An anchored pattern that may open with whitespace cannot narrow an index to a
// prefix: the registry's `code` index is scanned whole — about 220 cars — and an old-book
// `vehicleCode` index is scanned over its string keys only (registry-linked rows store `null`).
// Both are small enough that this costs nothing.
import { normalizeVehicleCode } from '@ecms/contracts';

/**
 * Every character of a code as itself. A NUL is written `\x00` rather than left in the pattern:
 * BSON refuses a regex whose source holds a null byte, so a `?vehicleCodes=a%00b` would otherwise
 * throw in the driver and answer 500 instead of "no such car". PCRE and JavaScript both read
 * `\x00` as that same character.
 */
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\0/g, '\\x00');

/**
 * Whitespace as the BROWSER reads it — the class written out for the database.
 *
 * The web reads a code with JavaScript's `\s` (`normalizeVehicleCode`, `sameVehicleCode`, the
 * parser), which is Unicode whitespace: a no-break space, a thin space, an ideographic space. The
 * database's `\s` is ASCII only (PCRE without UCP). A go-live sheet out of Excel can carry
 * «كورولا 1» with a no-break space; the web offers it as «كورولا 1», and a bare `\s` here would
 * answer that pick with an empty table — the owner's very symptom, in another spelling.
 *
 * So the class names the rest of JavaScript's `\s` itself:
 *   • `\s` — ASCII whitespace, in both engines;
 *   • `\v` — the line and paragraph separators U+2028 / U+2029 for the database, whose `\v` is
 *     vertical whitespace (in JavaScript it is the vertical tab, already in `\s`). They cannot be
 *     written as themselves: V8 spells them `\u2028` in a pattern's source, and the database
 *     refuses `\u` — a 500. PCRE's `\v` also takes U+0085 (NEL), Unicode whitespace JavaScript's
 *     `\s` leaves out: the database finds a stored «كورولا<NEL>1» too, never fewer cars;
 *   • every other Unicode space as the CHARACTER itself (the `\uXXXX` below are string escapes,
 *     so the pattern holds the characters, which both engines read as themselves).
 * In JavaScript the class is exactly `\s`, so a unit spec's `.test` is the browser's answer.
 */
const SPACE = '[\\s\\v\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]';

/** The pattern a stored code must match to be this code — see the rule above. */
export const vehicleCodePattern = (code: string): RegExp => {
  const words = normalizeVehicleCode(code).split(' ').map(escapeRegExp);
  return new RegExp(`^${SPACE}*${words.join(`${SPACE}+`)}${SPACE}*$`, 'i');
};

/**
 * `{ $in: [...] }` for a code field: the stored codes that are ANY of these. Blank codes name no
 * car and are left out; no codes at all is an empty `$in`, which matches nothing — the honest
 * answer to a list that names no car.
 */
export const anyVehicleCode = (codes: readonly string[]): { $in: RegExp[] } => ({
  $in: codes.filter((code) => code.trim() !== '').map(vehicleCodePattern),
});
