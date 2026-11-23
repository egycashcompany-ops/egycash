// `it_locations` — «المواقع»: where a department keeps what it holds — «غرفة السيرفرات», «غرفة
// الكاميرات» — one list PER BRANCH on the catalogs page (2026-11-19: «أعينها فى مكان بس تبقى على عهده
// الإدارة .. زى السيرفرات والكاميرات والسويتشات»).
//
// Its own collection, not a kind of `it_catalog_items` (design §2.4): the catalog is org-level
// (`super(ItCatalogItemModel, {})`) with ONE name per kind (`ux_kind_name_ar`), so «غرفة السيرفرات»
// in a second branch would be refused, and widening that index is drift index-sync never rebuilds.
// A place is a branch's: every row carries `branchId`, read and written under the branch reach of
// `itCatalog.manage` — ATM's per-branch label list (`atm_ref_labels`) the house precedent.
//
// A place never changes branch (a new one is made), and is RETIRED (`isActive: false`), never
// deleted: a custody interval and a consumables movement keep naming it, and retiring is refused
// while assets are held there (location.service.ts).
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItLocationDoc extends BaseDocFields {
  /** The branch the place is in — the scope it is read and written under. Never changes. */
  branchId: Types.ObjectId;
  name: LocalizedString;
  code: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

const locationSchema = new Schema<ItLocationDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    code: { type: String, default: null },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One Arabic name per branch: two branches may each have «غرفة السيرفرات», one branch may not have
// it twice. The service asks first, for a message that names the place; the index holds the race.
locationSchema.index(
  { branchId: 1, 'name.ar': 1 },
  { unique: true, name: 'ux_branch_name_ar', partialFilterExpression: { isDeleted: false } },
);
// The pickers and the tab: one branch's places, active first, in their order.
locationSchema.index({ branchId: 1, isActive: 1, sortOrder: 1 }, { name: 'ix_branch_active_sort' });

export const ItLocationModel = model<ItLocationDoc>('ItLocation', locationSchema, 'it_locations');
