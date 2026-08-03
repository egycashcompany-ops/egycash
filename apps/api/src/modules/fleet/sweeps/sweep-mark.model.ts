// Sweep idempotency marks (owner FL-4 point 4) — the A-5 pattern: the unique index IS the
// idempotency. A sweep may run twice, overlap itself, or replay after a crash; only the run that
// INSERTS a mark emits the corresponding event. Operational bookkeeping, not business data: no
// soft delete, no versioning, and nothing here is ever read to answer a business question —
// the alarm itself stays derived (FR-3); marks only stop the same fact being ANNOUNCED twice.
//
// Keys are deterministic over the fact's identity, so the announcement re-arms exactly when the
// fact changes: a renewed license carries a new expiry date → new key; a new service visit is a
// new alarm baseline → new key.
import { Schema, model } from 'mongoose';

export interface FleetSweepMarkDoc {
  key: string;
  createdAt: Date;
}

const sweepMarkSchema = new Schema<FleetSweepMarkDoc>(
  {
    key: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

sweepMarkSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

const FleetSweepMarkModel = model<FleetSweepMarkDoc>(
  'FleetSweepMark',
  sweepMarkSchema,
  'fleet_sweep_marks',
);

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** True exactly once per key — the caller announces only on true. */
export const markOnce = async (key: string): Promise<boolean> => {
  try {
    await FleetSweepMarkModel.create({ key });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
};
