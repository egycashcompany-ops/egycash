// Fleet catalogs (design §2.10): one collection, six kinds — workshops, work types, spare parts,
// mission types, violation types, unavailability reasons. Archive + rename replace the legacy's
// append-only lists, where an admin typo lived forever.
import { Schema, model } from 'mongoose';
import { FLEET_CATALOG_KINDS, type FleetCatalogKind, type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetCatalogItemDoc extends BaseDocFields {
  kind: FleetCatalogKind;
  name: LocalizedString;
  /** `workType` only: closing a visit of this type resets the maintenance-alarm baseline. */
  countsForAlarm: boolean;
  isActive: boolean;
}

const catalogItemSchema = new Schema<FleetCatalogItemDoc>(
  {
    kind: { type: String, required: true, enum: FLEET_CATALOG_KINDS },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    countsForAlarm: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

catalogItemSchema.index(
  { kind: 1, 'name.ar': 1 },
  { unique: true, name: 'ux_kind_name_ar', partialFilterExpression: { isDeleted: false } },
);
catalogItemSchema.index({ kind: 1, isActive: 1 }, { name: 'ix_kind_active' });

export const FleetCatalogItemModel = model<FleetCatalogItemDoc>(
  'FleetCatalogItem',
  catalogItemSchema,
  'fleet_catalog_items',
);
