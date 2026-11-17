/**
 * Which paper a hand-over records (FR-18), from what the dialog last printed.
 *
 * «فى الـ IT تحديداً فى تسليم العهدة عايزك تسمح عادى بالتسليم حتى لو مطبعش إيصال» (2026-11-08): the
 * hand-over no longer waits for the print. It still writes a receipt every time, so the one question
 * left is whose number that receipt carries:
 *
 * - `printed` — the paper printed for exactly what is about to be recorded: its number.
 * - `stale` — a paper was printed, then something changed: that paper no longer says what is
 *   recorded, so its number is NOT sent and the server gives the receipt the next one, as if
 *   nothing had been printed. A receipt must never claim a paper that lists other lines.
 * - `optional` — nothing printed: the server gives the next number; the paper prints later from the
 *   «عهدة الأصول» register, the asset's page or the employee's page.
 *
 * `printedFor` is the request the last paper was composed from (JSON); `payloadKey` the request as
 * it stands now.
 */
export type HandOverPaperState = 'printed' | 'stale' | 'optional';

export const handOverPaper = (
  printedFor: string | null,
  payloadKey: string,
  printedNumber: number | null,
): { state: HandOverPaperState; formNumber: number | null } => {
  if (printedFor === null) return { state: 'optional', formNumber: null };
  if (printedFor !== payloadKey) return { state: 'stale', formNumber: null };
  return { state: 'printed', formNumber: printedNumber };
};

/**
 * Whether «تسليم» may be pressed: the form is complete and no paper is being composed — the paper
 * on its way may yet be the one to record, so the hand-over waits for it to arrive, never for it to
 * be asked for.
 */
export const canHandOver = (ready: boolean, isPrinting: boolean): boolean => ready && !isPrinting;
