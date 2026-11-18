// «الاتجاه» as both crew saves store it — the day's board (`crew.service.ts`) and the standing
// crew (`standing-crew.service.ts`): one rule for the two, so the two boxes behave alike — and
// since Round 28b so the day takes what the standing crew holds: «تحميل الطاقم الثابت» on the board
// copies the people AND the direction, never the time (`standing-load.ts`, the owner's «اه»). It
// copies a direction onto a van it fills whose row has none, and never one THIS rule would refuse
// there (`standingDirectionForDay` mirrors it line for line), so «حفظ» after a load goes through.
//
// Round 28 — «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست», which REVERSES Round 20's «اقدر
// اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك» (422
// `OPERATIONS_DIRECTION_NOT_AN_AREA`, no longer sent):
//
//   · UNCHANGED — the direction the row already holds (or one a row removed in the same save
//     carries over), compared once tidied: kept EXACTLY as written, a legacy one included, however
//     long, and blank or «-» too (Round 28 critic — the standing crew's plain box before #741 and
//     the board before Round 20 stored any text, «  » included; refused, that row could never be
//     saved again);
//   · NEW OR CHANGED, naming nothing (`operationsDirectionNamesSomething` — blank, «-», a
//     zero-width space) → 400 `VALIDATION_FAILED` on `body.rows.<index>.direction` (`TOO_SMALL`):
//     the board's box never offers such text, and a row the filters count «بدون اتجاه» must not
//     look as though it had one;
//   · NEW OR CHANGED, naming active areas only (`canonicalOperationsDirection`) — stored in the
//     areas' own spelling, as since Round 20 («المعادى» → «المعادي»), however long: «معادي/حلوان»
//     typed is «المعادي - حلوان» stored, so ten areas typed in 78 characters are 120 stored;
//   · anything else — stored AS TYPED, tidied (`normalizeOperationsDirection`), and that HAND-TYPED
//     text is held to `OPERATIONS_DIRECTION_MAX_LENGTH` → else 400 `VALIDATION_FAILED` on
//     `body.rows.<index>.direction` (`TOO_BIG`), the shape's own dialect. The ceiling is the
//     hand-typed text's, not every direction's: held by the shape, it refused a row's own direction
//     of many areas saved since Round 20 — and the board's own respelling of ten areas — so the row
//     could never be saved again.
//
// The areas are read once per save, and only when some row brings a new direction (most saves
// move people and touch no direction at all).
import {
  OPERATIONS_DIRECTION_MAX_LENGTH,
  canonicalOperationsDirection,
  normalizeOperationsDirection,
  operationsDirectionNamesSomething,
} from '@ecms/contracts';
import { ValidationError } from '../../../shared/errors';
import { operationsAreaRepository } from '../areas/area.repository';

export type DirectionToStore = (
  sent: string | null | undefined,
  kept: Iterable<string | null | undefined>,
  /** The row's place in the save's `rows` — named by a refusal. */
  index: number,
) => Promise<string | null>;

/** One resolver per save: it reads the active areas at most once. */
export const directionResolver = (): DirectionToStore => {
  let areaNames: Promise<string[]> | null = null;
  return async (sent, kept, index) => {
    if (sent == null) return null;
    const typed = normalizeOperationsDirection(sent);
    for (const held of kept) {
      if (held != null && normalizeOperationsDirection(held) === typed) return held;
    }
    if (!operationsDirectionNamesSomething(typed)) {
      throw new ValidationError([
        {
          field: `body.rows.${index}.direction`,
          code: 'TOO_SMALL',
          message: 'a direction names at least one letter or digit',
        },
      ]);
    }
    areaNames ??= operationsAreaRepository.activeNames();
    const canonical = canonicalOperationsDirection(typed, await areaNames);
    if ('direction' in canonical) return canonical.direction;
    if (typed.length > OPERATIONS_DIRECTION_MAX_LENGTH) {
      throw new ValidationError([
        {
          field: `body.rows.${index}.direction`,
          code: 'TOO_BIG',
          message: `a direction typed by hand is at most ${OPERATIONS_DIRECTION_MAX_LENGTH} characters`,
        },
      ]);
    }
    return typed;
  };
};
