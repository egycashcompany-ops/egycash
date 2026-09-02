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
// The plate is deliberately not consulted. Both boards used to accept it, which meant a dispatcher
// typing a plate got a row whose only visible identifier — the code in the cell — was not what
// they typed, and no way to tell why that row was the answer.
import { splitVehicleCodeList } from '@ecms/contracts';
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
  return wanted.length === 0 || wanted.some((one) => foldIncludes(code, one));
};
