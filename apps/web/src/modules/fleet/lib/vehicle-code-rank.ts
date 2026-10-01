// «اكتب الكود» — which cars a typed fragment offers, and in what order.
//
// A clerk types the code off a piece of paper, so the cars whose code STARTS with what was typed
// come first: «21» offers 210…219 before 121 and 221. Codes that only CONTAIN it follow, so a
// fragment from the middle of a code still finds it. Inside each group the registry's own order is
// kept. Nothing typed offers every car.
//
// WHICH cars match is `matchesVehicleCode`'s answer — the same one the roster boards give; this
// only decides the order.
import { fold } from '../../../shared/lib/fold';
import { matchesVehicleCode } from './vehicle-code-match';

export const rankVehicleCodes = (codes: readonly string[], typed: string): string[] => {
  const prefix = fold(typed.trim());
  const starts: string[] = [];
  const contains: string[] = [];
  for (const code of codes) {
    if (!matchesVehicleCode(code, typed)) continue;
    if (prefix !== '' && fold(code).startsWith(prefix)) starts.push(code);
    else contains.push(code);
  }
  return [...starts, ...contains];
};
