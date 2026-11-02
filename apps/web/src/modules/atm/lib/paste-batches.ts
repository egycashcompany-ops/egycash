// A pasted list sent in consecutive requests — for the screens whose requests are SAFE TO SEND
// AGAIN: a line the server already handled is answered as such on a second send, never doubled.
// The settlement plan's «إضافة ماكينات» answers it «موجودة في هذه التغذية» (`duplicateInRun`);
// the data-edit bulk add, «مسجلة من قبل» (`skippedCodes`); the bulk delete, an unknown code. So
// when a run stops, every line not confirmed goes back into the boxes — the failed request's own
// lines too, which may have partly gone through; the screen says so, and that sending them again
// is safe. (The open forms are NOT such screens: a replenishment opens again on every send, so
// `openInBatches` keeps a request's lines of unknown result apart.)
//
// Owner, 2026-11-01: «صلّح كمان إضافة الماكينات والـ bulk add» — after the open forms took any
// number of lines.
import { ApiError, getActiveBranch } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { type Locale } from '@ecms/contracts';

/**
 * The top-bar branch changed between two requests of a run. Every run here depends on it — the
 * open forms and the data-edit bulk forms resolve the acting branch per request, and the plan is
 * read within its scope — so the run stops before the next one, which would have gone to the other
 * branch. The switcher itself waits while a run goes (`holdBranchSwitch`); this is the backstop for
 * a branch changed without it (a stored branch retired meanwhile).
 */
export class BranchChangedError extends Error {
  constructor() {
    super('the selected branch changed during the run');
    this.name = 'BranchChangedError';
  }
}

/**
 * Pure: did this failure refuse the request before anything was written? The API's 4xx answers to
 * an open — validation, permission, a branch move running, «choose a branch» — are all decided
 * before the first row is created (both open services check first, then write), and the settlement
 * plan add's one transaction rolls back on every 4xx. Anything else leaves the request's outcome
 * unknown. NOT true of the data-edit bulk forms, whose 4xx can follow rows already written.
 */
export const refusedBeforeWriting = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500;

/** A run that may stop before the next request: the branch at its start, checked before each. */
export const branchPin = (): { moved: () => boolean } => {
  const atStart = getActiveBranch();
  return { moved: () => getActiveBranch() !== atStart };
};

/** A paste sent in batches: what each request answered, and what is left if the run stopped. */
export interface PasteRun<Row, Answer> {
  answers: Answer[];
  /** The rows not confirmed — the failed request's and every row after it. Empty when all went. */
  left: Row[];
  /**
   * How many of `left` the failed request carried and may have partly done — 0 when the request
   * was refused before writing on a screen whose refusals write nothing (`refusalWritesNothing`).
   */
  maybeDone: number;
  /** Why the run stopped; `null` when every row went. */
  failure: unknown;
}

/**
 * Pure orchestration: `rows` in consecutive requests of `size`, in order, one at a time. The FIRST
 * request failing fails the run exactly as one request did — the caller's error handling runs and
 * the boxes keep everything. A LATER one failing stops the run without throwing: what the earlier
 * requests answered stands, and `left` is the rest from the failed request on. With `pinBranch`,
 * a top-bar branch switch between two requests stops the run before the next one (nothing of
 * `left` was sent).
 */
export const inPasteBatches = async <Row, Answer>(
  rows: readonly Row[],
  size: number,
  send: (batch: Row[]) => Promise<Answer>,
  options: {
    pinBranch: boolean;
    /** Every 4xx of this endpoint is decided before anything is written (`refusedBeforeWriting`). */
    refusalWritesNothing: boolean;
  },
): Promise<PasteRun<Row, Answer>> => {
  const pin = branchPin();
  const answers: Answer[] = [];
  for (let start = 0; start < rows.length; start += size) {
    if (options.pinBranch && start > 0 && pin.moved()) {
      return { answers, left: rows.slice(start), maybeDone: 0, failure: new BranchChangedError() };
    }
    const batch = rows.slice(start, start + size);
    try {
      answers.push(await send(batch));
    } catch (error) {
      if (start === 0) throw error;
      const nothingWritten = options.refusalWritesNothing && refusedBeforeWriting(error);
      return {
        answers,
        left: rows.slice(start),
        maybeDone: nothingWritten ? 0 : batch.length,
        failure: error,
      };
    }
  }
  return { answers, left: [], maybeDone: 0, failure: null };
};

/**
 * Pure: a paste without repeats — the first line of each key is kept, in order; every later one
 * comes back apart with its line index. A run must decide repeats over the WHOLE paste: split into
 * requests, a repeat in a later request would meet the first one as already done, or (on the plan)
 * be read as a line of its own.
 */
export const firstOfEach = <Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
): { kept: Row[]; keptIndex: number[]; repeats: { row: Row; index: number }[] } => {
  const seen = new Set<string>();
  const kept: Row[] = [];
  const keptIndex: number[] = [];
  const repeats: { row: Row; index: number }[] = [];
  rows.forEach((row, index) => {
    const key = keyOf(row);
    if (seen.has(key)) {
      repeats.push({ row, index });
      return;
    }
    seen.add(key);
    kept.push(row);
    keptIndex.push(index);
  });
  return { kept, keptIndex, repeats };
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Why a run stopped, in the reader's words — the branch switch has its own. */
export const runFailureText = (failure: unknown, t: Translate, locale: Locale): string =>
  failure instanceof BranchChangedError
    ? t('atm.common.branchChanged')
    : errorMessage(failure, locale);
