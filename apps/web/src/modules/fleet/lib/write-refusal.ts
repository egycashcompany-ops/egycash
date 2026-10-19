// What a refused write means to the screen that sent it — so it can say WHICH rule refused it and
// read the record again, instead of the generic «هذا الإجراء يتعارض مع الحالة الحالية» (the server's
// own sentence is English and never shown).
//
//   locked  422 — a business rule: the record is held by something that happened since the screen
//                 read it (a licence memo settled by «تسوية عهدة», a receipt put on a custody memo,
//                 or that memo replenished).
//   stale   409 — the record changed after it was read (its version moved; a settlement moves it
//                 too).
import { ApiError } from '../../../shared/lib/api-client';

export type WriteRefusal = 'locked' | 'stale';

/** `null` for anything else — a network drop, a 400, a 404 — which keeps its usual message. */
export const writeRefusalOf = (error: unknown): WriteRefusal | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 422 && error.code === 'BUSINESS_RULE_VIOLATION') return 'locked';
  if (error.status === 409 && error.code === 'STALE_DOCUMENT') return 'stale';
  return null;
};
