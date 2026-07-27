// Configurable contract numbering (frozen design A1): `contracts.numberFormat` is a
// pattern of {prefix}, {year} and {seq[:pad]} tokens over a per-year atomic counter in
// the shared hr_sequences collection. Format changes affect FUTURE contracts only —
// every issued number is immutable (unique index as the second line of defence).
import mongoose, { Schema, type Model } from 'mongoose';

interface SequenceDoc {
  _id: string;
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

const HrSequenceModel: Model<SequenceDoc> =
  (mongoose.models.HrSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('HrSequence', sequenceSchema);

export const DEFAULT_CONTRACT_NUMBER_FORMAT = 'ECMS-CON-{year}-{seq:6}';

/** Pure: render a pattern like `ECMS-CON-{year}-{seq:6}` → `ECMS-CON-2026-000001`. */
export const formatContractNumber = (pattern: string, year: number, seq: number): string =>
  pattern
    .replace(/\{year\}/g, String(year))
    .replace(/\{seq(?::(\d{1,2}))?\}/g, (_m, pad: string | undefined) =>
      String(seq).padStart(pad === undefined ? 6 : Number(pad), '0'),
    );

/** Atomic next number for `year` under the configured pattern. */
export const nextContractNumber = async (pattern: string, year: number): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: `contract:${year}` },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatContractNumber(pattern, year, doc?.value ?? 1);
};
