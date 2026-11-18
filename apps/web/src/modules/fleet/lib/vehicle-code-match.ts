// Matching a car by code, in the browser, the way the registry matches it on the server.
//
// Two boards filter rows they ALREADY hold — the daily roster and the fixed roster — so there is
// no request to narrow and no `?code=` to send. They still have to answer the same question the
// server answers for every other vehicle-code box in the application, and answer it the same way,
// or "which cars?" means one thing on six screens and something else on two.
//
// So this is the client-side twin of `vehicleCodeSearchQuery`, built out of the two pieces that
// already define the answer rather than a third spelling of it:
//
//   • `splitVehicleCodeList` — the canonical parser, the same one `readTypedVehicleCodes` and the
//     `?vehicleCodes=` contract read a box with. It is what makes `150 -` mean the car 150 and not
//     a term no car carries, and what lets one box name several cars at once.
//   • `foldIncludes` — the application's shared matcher, so a code matches here exactly as it
//     matches in every other list, Arabic digits and all.
//
// A code holding a space («كورولا 1», «MG 2») is one car on both sides: the parser reads the typed
// «كورولا 1» as that one code, and the code it is held against is read with its whitespace as one
// space (`normalizeVehicleCode`), so a registry «فورتشنر 2 » answers «فورتشنر 2».
//
// The plate is deliberately not consulted. Both boards used to accept it, which meant a dispatcher
// typing a plate got a row whose only visible identifier — the code in the cell — was not what
// they typed, and no way to tell why that row was the answer.
//
// TWO QUESTIONS, TWO ANSWERS. A box being TYPED into is a search: «كورولا» finds every Corolla
// and «41» finds 410 (`matchesVehicleCode`). A list of codes PICKED from the board's own options,
// or carried on a link («فتح» beside a car on the fleet dashboard), names those cars and no other:
// «كورولا 1» is car «كورولا 1», never «كورولا 10» or «كورولا 11» (`isAnyVehicleCode`) — which is
// what the same codes mean on every other screen, where `?vehicleCodes=` reaches the server's
// `anyVehicleCode`.
import { asciiDigits, normalizeVehicleCode, splitVehicleCodeList } from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';

/**
 * Does this vehicle code answer what was typed?
 *
 * Several codes in the box are OR-ed: `150 - 151` shows both cars, which is the one thing a board
 * filter can do that a single substring cannot, and what the same text means in the filter bar.
 * A box holding no code at all — empty, whitespace, a lone dash — narrows nothing.
 */
export const matchesVehicleCode = (code: string, term: string): boolean => {
  const wanted = splitVehicleCodeList(term);
  if (wanted.length === 0) return true;
  const held = normalizeVehicleCode(code);
  return wanted.some((one) => foldIncludes(held, one));
};

/**
 * One code as a whole-code comparison reads it — the server's `vehicleCodePattern` rule: its
 * whitespace as one space, Latin case ignored; and Arabic-Indic digits as Latin, the fold every
 * code box in the browser applies.
 */
const wholeCode = (code: string): string => asciiDigits(normalizeVehicleCode(code)).toLowerCase();

/**
 * Is this vehicle code one of the codes listed — the WHOLE code, never a part of it?
 *
 * The browser's twin of the server's `anyVehicleCode` (api vehicles/vehicle-code-match.ts): the
 * list is read by the canonical parser (`150 - 151`, `150,151`, «كورولا 1» as one code), and each
 * code is compared whole, so «كورولا 1» answers car «كورولا 1» alone and «5» answers car 5 alone,
 * not 15, 150 or 215. What the two roster boards narrow their picked codes (`?q=`) by.
 *
 * A list naming no code at all — empty, whitespace, a lone dash — narrows nothing, as on the
 * server, where such a `?vehicleCodes=` is no filter.
 */
export const isAnyVehicleCode = (code: string, term: string): boolean => {
  const wanted = splitVehicleCodeList(term);
  if (wanted.length === 0) return true;
  const held = wholeCode(code);
  return wanted.some((one) => wholeCode(one) === held);
};
