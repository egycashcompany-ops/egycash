// The consumables' two series, both in the module's one counter (`it_sequences`, design §2.1):
//
//   · an item's code — «CON-00001», global, permanent, never reused, the way an asset's is;
//   · a memo's number — the paper's OWN series, «EGYCASH-IT-CON-0001» once printed (the printed form
//     lives in the contracts, `formatConsumableMemoNumber`, because the screen prints it too).
//
// Pure. Every value is taken INSIDE the transaction that writes it (`reserveSequenceBlock`), so a
// write that rolls back — a name the store already has, a quantity it does not hold — gives its
// number back instead of leaving a gap in either series.

export const CONSUMABLE_SEQUENCE_KEY = 'consumable:global';

export const CONSUMABLE_MEMO_SEQUENCE_KEY = 'consumableMemo:global';

/** Width the code pads to; a larger sequence simply grows wider — the format never truncates. */
export const CONSUMABLE_CODE_MIN_DIGITS = 5;

export const formatConsumableCode = (seq: number): string =>
  `CON-${String(seq).padStart(CONSUMABLE_CODE_MIN_DIGITS, '0')}`;
