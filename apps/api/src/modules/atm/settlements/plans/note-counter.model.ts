// The Notes' running numbers — «مسلسل» on «محضر جرد ماكينة الصراف الآلى», one counter per
// branch × bank that never restarts (DS-11; docs/12-planning/atm-settlements-phase1.md §4.9).
// Operational bookkeeping, not business data: no soft delete, no versioning.
//
// The fleet counter, as is (`fleet/custody/custody-counter.model.ts`), and for the same reasons:
// two issues at once meet a write conflict on this ONE document, which `withTransaction` retries,
// so the numbers come out distinct and gap-free; an aborted issue takes its increment back. The
// counter never starts below a number already used: `ensureNoteCounter` raises `seq` to the floor it
// is given (`$max`) and never lowers it, so a counter that went missing comes back at the highest
// serial ever handed out (live lines and voided serials alike) instead of colliding with Note 1.
import { Schema, model, type ClientSession, type Types } from 'mongoose';
import { type AtmBankCode } from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';

export interface AtmNoteCounterDoc {
  _id: Types.ObjectId;
  /** 'atm-note:<branchId>:<bankCode>'. */
  key: string;
  /** The last number handed out. */
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

const noteCounterSchema = new Schema<AtmNoteCounterDoc>(
  {
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, strict: true, versionKey: false },
);

noteCounterSchema.index({ key: 1 }, { unique: true, name: 'ux_note_counter_key' });

export const AtmNoteCounterModel = model<AtmNoteCounterDoc>(
  'AtmNoteCounter',
  noteCounterSchema,
  'atm_note_counters',
);

/** The counter of one branch × bank. */
export const noteCounterKey = (branchId: string, bankCode: AtmBankCode): string =>
  `atm-note:${branchId}:${bankCode}`;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Make sure the counter exists and stands at least at `floor` — create-if-missing, never lowered.
 * Call it OUTSIDE the issue transaction; a racing twin's duplicate key is the same outcome.
 */
export const ensureNoteCounter = async (key: string, floor = 0): Promise<void> => {
  try {
    await AtmNoteCounterModel.updateOne(
      { key },
      { $max: { seq: Math.max(0, Math.trunc(floor)) } },
      { upsert: true },
    ).exec();
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
};

/**
 * `n` consecutive numbers inside the caller's transaction: returns the first. Two issues at once
 * conflict on this document and one of them is retried.
 */
export const takeNoteSerials = async (
  key: string,
  n: number,
  session: ClientSession,
): Promise<number> => {
  const counter = await AtmNoteCounterModel.findOneAndUpdate(
    { key },
    { $inc: { seq: n } },
    { new: true, session },
  )
    .lean<AtmNoteCounterDoc>()
    .exec();
  if (counter === null) throw new ConflictError('the Note counter is not ready yet — try again');
  return counter.seq - n + 1;
};
