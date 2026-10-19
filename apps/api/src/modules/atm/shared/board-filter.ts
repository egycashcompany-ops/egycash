// The open boards' bank/area filter, as plain functions over the names the rows store.
//
// A bank or an area is free text copied onto every operation as written, so one bank can be
// stored under spellings that differ only by surrounding spaces — «NBE» from one form, «NBE »
// from a label typed with a trailing space. The board shows both as «NBE», and the filter used to
// treat them as two: the dropdown offered «NBE» twice, and picking the spaced one matched the
// OTHER spelling's rows, because the query parser trims what it receives. Here a name is what is
// left after trimming, on the dropdown's side and on the match's side alike.

/** What identifies a bank or an area: the stored text without its surrounding spaces. */
export const boardName = (stored: string): string => stored.trim();

/** The dropdown's list: each name once, blank ones dropped, in the order the boards always used. */
export const boardNames = (stored: readonly string[]): string[] =>
  [...new Set(stored.map(boardName))].filter((name) => name !== '').sort();

/**
 * The stored spellings that a set of requested names stands for — what a plain `$in` on the
 * stored field needs. A requested name nothing open is stored under contributes nothing, so a
 * filter on it matches nothing rather than being dropped (the board answers the question asked).
 */
export const storedSpellingsOf = (
  stored: readonly string[],
  requested: readonly string[],
): string[] => {
  const wanted = new Set(requested.map(boardName));
  return stored.filter((spelling) => wanted.has(boardName(spelling)));
};
