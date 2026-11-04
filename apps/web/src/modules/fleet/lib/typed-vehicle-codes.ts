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
//
// A SPACE AFTER A WORD finishes nothing yet. «كورولا 1», «MG 2», «بيجو 5008» are single cars
// (`splitVehicleCodeList`), so the space after «كورولا» may be the middle of a code, not its end:
// taking «كورولا» there ticked a car nobody has and left «1» in the box. The word waits in the box,
// space and all, as the live search — it lists «كورولا 1», «كورولا 2» — until what follows decides:
// a number makes it «كورولا 1»; a hard separator (a comma, a semicolon, a new line, a spaced dash),
// another word, Enter, or the list closing take the word as it is. A space after a NUMBER (`150 `,
// `كورولا 1 `) still takes it at once, as it always did.
import {
  normalizeVehicleCode,
  splitVehicleCodeList,
  vehicleCodeTakesNumber,
} from '@ecms/contracts';

/** Text ending in a separator: a comma, semicolon, newline, a spaced dash, or plain whitespace. */
const ENDS_OPEN = /[,;\n\r]\s*$|\s+-\s*$|\s$/;
/** Text ending in a HARD separator — one that finishes a word as surely as a number. */
const ENDS_HARD = /[,;\n\r]\s*$|\s+-\s*$/;
/** The last whitespace-free run of the text, and the whitespace after it. */
const LAST_TOKEN = /(\S+)\s+$/;

export interface TypedVehicleCodes {
  /** Complete codes, to be added to the selection. */
  chosen: string[];
  /** What is still being written — the box's text, and the registry's search term. */
  typing: string;
}

export const readTypedVehicleCodes = (raw: string): TypedVehicleCodes => {
  // A word and then a space: everything before the word is finished, the word is not (see above).
  const last = ENDS_HARD.test(raw) ? null : LAST_TOKEN.exec(raw);
  if (last !== null && vehicleCodeTakesNumber(last[1] as string)) {
    return {
      chosen: splitVehicleCodeList(raw.slice(0, last.index)),
      typing: `${last[1] as string} `,
    };
  }
  const codes = splitVehicleCodeList(raw);
  // An empty box has nothing open; text ending in a separator has nothing left to finish.
  const stillWriting = raw !== '' && !ENDS_OPEN.test(raw);
  return stillWriting
    ? { chosen: codes.slice(0, -1), typing: codes[codes.length - 1] ?? '' }
    : { chosen: codes, typing: '' };
};

/**
 * What the box holds when the reader is done with it — Enter, or the list closing.
 *
 * Enter takes whatever is left, separator or not: the last code of a list needs no trailing
 * punctuation to be meant. Closing the list takes only a word that was FINISHED with a space and
 * left waiting for a number (`كولراى `) — the one thing a space used to take on its own; a fragment
 * still being written when the reader clicked away (`كور`) is dropped, as it always was.
 */
export const finishTypedVehicleCodes = (raw: string, how: 'enter' | 'close'): string[] =>
  how === 'enter' || /\S\s+$/.test(raw) ? splitVehicleCodeList(raw) : [];

/**
 * The codes typed, each written the way the list OFFERS it when the list has it — `mg 2` is the
 * option «MG 2», `كورولا  1` the option «كورولا 1» — so a typed code ticks the very row a click
 * would have, and the selection never holds two spellings of one car.
 */
export const canonicalVehicleCodes = (
  typed: readonly string[],
  offered: readonly string[],
): string[] => {
  const key = (code: string): string => normalizeVehicleCode(code).toLowerCase();
  const byKey = new Map<string, string>();
  for (const code of offered) if (!byKey.has(key(code))) byKey.set(key(code), code);
  return typed.map((code) => byKey.get(key(code)) ?? code);
};
