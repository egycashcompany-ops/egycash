// One append-only timeline implementation for the whole IT module (design §2.3, §2.6).
//
// Assets need a custody history (IT-2); tickets need an identical stream that is both history and
// conversation (IT-3). The design's rule is that "the idiom appears twice in the product but once
// in the code", so this is a model FACTORY parameterized by collection, type vocabulary and the
// few TYPED fields a consumer needs — not a second copy waiting to drift from the first.
//
// Extra fields are typed columns rather than `metadata` keys on purpose: the ticket stream has to
// FILTER on comment visibility (FR-7) and on status transitions, and you cannot index a probe into
// a free-form object. `metadata` stays for facts nobody queries.
//
// The subject key is `subjectId` in every collection rather than `assetId`/`ticketId`. That is
// deliberate: reads are `.lean()`, which returns raw BSON and applies no virtuals, so a "friendly
// alias" would be `undefined` on every read — the same class of bug as the minimization one below.
// The mapper names the field for the API; the storage stays uniform.
//
// Two things here are load-bearing rather than stylistic, and both come from production:
//
//   * `minimize: false` — Mongoose minimization DELETES empty objects on the way to the database,
//     so a row written with `metadata: {}` was stored with no `metadata` field at all. Reads are
//     `.lean()`, which applies no schema default, so it came back `undefined` and broke the DTO's
//     `Record<string, unknown>` guarantee. That is the PR #117 outage, exactly.
//   * `actorName` is denormalized and NOT `required` — Mongoose rejects `''` for a required
//     String, which would make its own default unsavable. A system actor writes an empty name,
//     and history that outlives a user rename is the whole point of storing it.
import { Schema, model, type IndexDefinition, type IndexOptions, type Model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItTimelineDoc extends BaseDocFields {
  /** The row this entry belongs to: the asset in IT-2, the ticket in IT-3. */
  subjectId: Types.ObjectId;
  type: string;
  at: Date;
  actorUserId: Types.ObjectId | null;
  actorName: string;
  metadata: Record<string, unknown>;
  notes: string | null;
}

export const buildItTimelineModel = <TDoc extends ItTimelineDoc>(options: {
  modelName: string;
  collection: string;
  types: readonly string[];
  /** Typed columns this timeline needs to filter or sort on. */
  extraFields?: Record<string, unknown>;
  extraIndexes?: [IndexDefinition, IndexOptions][];
}): Model<TDoc> => {
  const schema = new Schema<TDoc>(
    {
      subjectId: { type: Schema.Types.ObjectId, required: true },
      type: { type: String, enum: options.types, required: true },
      at: { type: Date, required: true },
      actorUserId: { type: Schema.Types.ObjectId, default: null },
      actorName: { type: String, default: '' },
      metadata: { type: Schema.Types.Mixed, required: true, default: {} },
      notes: { type: String, default: null },
      ...(options.extraFields ?? {}),
      ...baseFields,
    } as never,
    // See the header note — this flag is why empty metadata survives the round trip.
    { ...baseSchemaOptions, minimize: false },
  );

  // The subject's history, newest first — the only query the history tab makes.
  schema.index({ subjectId: 1, at: -1 }, { name: 'ix_subject_at' });
  // Cross-subject reads by kind of fact (reports; "everything disposed last quarter").
  schema.index({ type: 1, at: -1 }, { name: 'ix_type_at' });
  for (const [definition, indexOptions] of options.extraIndexes ?? []) {
    schema.index(definition, indexOptions);
  }

  return model<TDoc>(options.modelName, schema, options.collection);
};
