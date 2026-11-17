// The one-time fill's marks (P-ORG-3 §7): a row per company department that has been filled from
// where its holders sit. Unique per department entry — the index is what lets exactly one of two
// racing processes (the API and the worker both run the seed) commit a department's fill.
import { Schema, model, type Types } from 'mongoose';

export interface JobPlaceFillDoc {
  _id: Types.ObjectId;
  departmentCatalogId: Types.ObjectId;
  at: Date;
  /** How many places the fill wrote for this department (0 is a valid, final answer). */
  placed: number;
}

const jobPlaceFillSchema = new Schema<JobPlaceFillDoc>(
  {
    departmentCatalogId: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
    placed: { type: Number, required: true, default: 0 },
  },
  { strict: true },
);
jobPlaceFillSchema.index({ departmentCatalogId: 1 }, { unique: true, name: 'ux_departmentCatalogId' });

export const JobPlaceFillModel = model<JobPlaceFillDoc>(
  'JobPlaceFill',
  jobPlaceFillSchema,
  'job_title_place_fills',
);
