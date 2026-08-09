// Sweep announcement marks (ADR-025) — the A-5 pattern, and the Fleet `fleet_sweep_marks`
// precedent that design §4.8 points at.
//
// IT's first three sweeps needed nothing like this: the SLA breach stamp, the closed status and
// the generated order each ARE the record, so idempotency came free. The expiry sweep is the first
// that announces something with no home — "this license expires in 30 days" is a fact about today,
// not about the license — so the mark lives here rather than as a flag on a business document.
//
// The key embeds the DATE being announced, which is what makes renewal re-arm the announcement by
// itself: a new expiry date is a new key, so it warns again without anyone remembering to clear a
// flag. Operational bookkeeping only — no soft delete, no versioning, never read to answer a
// business question.
import { Schema, model } from 'mongoose';

export interface ItSweepMarkDoc {
  key: string;
  createdAt: Date;
}

const sweepMarkSchema = new Schema<ItSweepMarkDoc>(
  { key: { type: String, required: true }, createdAt: { type: Date, default: () => new Date() } },
  { versionKey: false },
);

sweepMarkSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

const ItSweepMarkModel = model<ItSweepMarkDoc>('ItSweepMark', sweepMarkSchema, 'it_sweep_marks');

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** True exactly once per key — the caller announces only on true. The unique index IS the guard. */
export const markOnce = async (key: string): Promise<boolean> => {
  try {
    await ItSweepMarkModel.create({ key });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
};

/** `2026-08-09T04:20:00Z` → `2026-08-09`. The announced fact's identity is its DAY, not its ms. */
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
