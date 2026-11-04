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
//
// A PICK CAN ANSWER IT. The waiting word lists its cars — «كورولا » offers «كورولا 1» and
// «كورولا 2» — and ticking (or unticking) one of them says which car the word meant. The word is
// then never taken as a car of its own: not by Enter, not by the next word typed after it, not by
// the list closing (`answersWaitingWord`, `readAnsweredBox`). It stays in the box, so the reader
// can tick «كورولا 2» from the same list. A pick of some other row — a chip removed, a car the word
// did not find — answers nothing, and the word is still taken as before.
import {
  normalizeVehicleCode,
  sameVehicleCode,
  splitVehicleCodeList,
  vehicleCodeTakesNumber,
} from '@ecms/contracts';
import { matchesVehicleCode } from './vehicle-code-match';

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
 * The word the box holds back for its number — `كورولا ` is «كورولا» — or `null` when the box holds
 * anything else: nothing, a fragment still mid-word (`كور`), a word and its number (`كورولا 1`).
 */
export const waitingVehicleWord = (box: string): string | null =>
  /\s$/.test(box) && vehicleCodeTakesNumber(box) ? normalizeVehicleCode(box) : null;

/**
 * The waiting word this change to the selection ANSWERED, or `null` when it answered none.
 *
 * A row the word finds (`matchesVehicleCode`, the rule the list is narrowed by) was ticked or
 * unticked: «كورولا » → «كورولا 1». Any other change — a chip removed, «مسح الكل», a car the word
 * does not find — leaves the word waiting.
 */
export const answersWaitingWord = (
  box: string,
  before: readonly string[],
  after: readonly string[],
): string | null => {
  const word = waitingVehicleWord(box);
  if (word === null) return null;
  const changed = [
    ...after.filter((code) => !before.includes(code)),
    ...before.filter((code) => !after.includes(code)),
  ];
  return changed.some((code) => matchesVehicleCode(code, word)) ? word : null;
};

/** Codes about to be taken from the box, less the word a pick has already answered. */
export const withoutAnsweredWord = (codes: readonly string[], answered: string | null): string[] =>
  answered === null ? [...codes] : codes.filter((code) => !sameVehicleCode(code, answered));

/**
 * `readTypedVehicleCodes`, for a box whose waiting word a pick may have answered: the answered word
 * is not chosen when what is typed next finishes it (`كورولا ك` chooses nothing and searches `ك`),
 * and the answer stands only while the box still holds that word — anything else typed is a new
 * question (`كورولا 2` is that car, to be taken as usual).
 */
export const readAnsweredBox = (
  raw: string,
  answered: string | null,
): TypedVehicleCodes & { answered: string | null } => {
  const { chosen, typing } = readTypedVehicleCodes(raw);
  const word = waitingVehicleWord(typing);
  return {
    chosen: withoutAnsweredWord(chosen, answered),
    typing,
    answered:
      answered !== null && word !== null && sameVehicleCode(word, answered) ? answered : null,
  };
};

/**
 * What the box holds when the reader is done with it, for a box whose waiting word a pick may have
 * answered — Enter takes what is left, the list closing a word left waiting
 * (`finishTypedVehicleCodes`), and neither takes the answered word.
 */
export const finishAnsweredBox = (
  raw: string,
  how: 'enter' | 'close',
  answered: string | null,
): string[] => withoutAnsweredWord(finishTypedVehicleCodes(raw, how), answered);

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

/**
 * The codes the control HOLDS — the page's codes, each written as the list offers it, once each.
 *
 * A code reaches the control in whatever spelling carried it: a car's own link writes the stored
 * «فورتشنر 2 » while the registry list offers «فورتشنر 2»; a board offers its rows' raw «فورتشنر 2 »
 * while the URL brings the parser's «فورتشنر 2»; a hand-written link says `mg 2` for «MG 2». Held
 * as carried, each of those was a ticked row of its own beside the unticked row it names — and
 * picking that row added the same car twice. Held as offered, the row is simply ticked.
 *
 * A code the list offers in exactly that spelling is held as it is, so a board that offers two
 * spellings of one car keeps each row tickable on its own. A code the list does not offer at all
 * is held as `normalizeVehicleCode` writes it.
 */
export const heldVehicleCodes = (
  value: readonly string[],
  offered: readonly string[],
): string[] => {
  const exact = new Set(offered);
  const held: string[] = [];
  for (const code of value) {
    const spelled = exact.has(code)
      ? code
      : (offered.find((one) => sameVehicleCode(one, code)) ?? normalizeVehicleCode(code));
    if (spelled === '' || held.includes(spelled)) continue;
    // Two carried spellings of a car the list does not offer are still one car.
    if (!exact.has(spelled) && held.some((one) => sameVehicleCode(one, spelled))) continue;
    held.push(spelled);
  }
  return held;
};
