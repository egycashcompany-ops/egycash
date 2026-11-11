// A28 — «عقد جديد» for a candidate: the page's state, kept on the server as it changes.
//
// «لو كنت بعمل عقد … و تلعط او جاهز قفل او سستم تايم اوت يتعملو ريكورد». One record per accepted
// offer: which papers are chosen, the values typed in for this candidate, the contract's term, the
// employee code kept at the first print, and whether — and when — the papers were printed. The hire
// is allowed once they were, and is recorded here too.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface CandidateDraftDoc extends BaseDocFields {
  offerId: Types.ObjectId;
  /** The papers chosen, by template key — null: every paper of the job (nothing chosen yet). */
  selected: string[] | null;
  /** Values typed in for this candidate, used by every paper that prints them. */
  overrides: { key: string; value: string }[];
  /** ISO dates. */
  startDate: string;
  endDate: string | null;
  hiringDate: string;
  /** Taken from the employee sequence at the first print, and given to the employee at the hire. */
  employeeNumber: string | null;
  printedAt: Date | null;
  printedBy: Types.ObjectId | null;
  printCount: number;
  employeeId: Types.ObjectId | null;
}

const candidateDraftSchema = new Schema<CandidateDraftDoc>(
  {
    offerId: { type: Schema.Types.ObjectId, required: true },
    selected: { type: [String], default: null },
    overrides: {
      type: [{ _id: false, key: { type: String, required: true }, value: { type: String, default: '' } }],
      default: [],
    },
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    hiringDate: { type: String, required: true },
    employeeNumber: { type: String, default: null },
    printedAt: { type: Date, default: null },
    printedBy: { type: Schema.Types.ObjectId, default: null },
    printCount: { type: Number, default: 0 },
    employeeId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

candidateDraftSchema.index(
  { offerId: 1 },
  { unique: true, name: 'ux_offer', partialFilterExpression: { isDeleted: false } },
);

export const CandidateDraftModel = model<CandidateDraftDoc>(
  'HrCandidateDraft',
  candidateDraftSchema,
  'hr_candidate_drafts',
);
