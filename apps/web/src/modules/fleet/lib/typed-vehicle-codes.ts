// Reading a box that is being typed into, one code at a time.
//
// The vehicle-code filter's search box is also its input: an operator reads codes off a message and
// writes `215 - 216 - 217`. Each code should be TAKEN the moment its separator is typed, so the
// chips fill in as they write and the list keeps answering the fragment they are still on.
//
// Before this, the whole text went to the registry as one search term. The instant a separator was
// typed the term became `150 - `, which names no car, so the list said "no results" over a box the
// reader was halfway through filling — and the codes already written were not selected either.
//
// The split is where the text ENDS. Ending in a separator means every code in it is finished;
// otherwise the last one is still being written and belongs in the box, not in the selection.
import { splitVehicleCodeList } from '@ecms/contracts';

/** Text ending in a separator: a comma, semicolon, newline, a spaced dash, or plain whitespace. */
const ENDS_OPEN = /[,;\n\r]\s*$|\s+-\s*$|\s$/;

export interface TypedVehicleCodes {
  /** Complete codes, to be added to the selection. */
  chosen: string[];
  /** What is still being written — the box's text, and the registry's search term. */
  typing: string;
}

export const readTypedVehicleCodes = (raw: string): TypedVehicleCodes => {
  const codes = splitVehicleCodeList(raw);
  // An empty box has nothing open; text ending in a separator has nothing left to finish.
  const stillWriting = raw !== '' && !ENDS_OPEN.test(raw);
  return stillWriting
    ? { chosen: codes.slice(0, -1), typing: codes[codes.length - 1] ?? '' }
    : { chosen: codes, typing: '' };
};
