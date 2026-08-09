// `it_software_installations` — what is installed where (design §2.8).
//
// The row SURVIVES removal: `removedAt` ends it, nothing deletes it. That is the same shape as
// `it_asset_assignments` — an interval with an open end — and for the same reason: "what was on
// this machine last year" is a question the register has to be able to answer.
//
// `branchId` is denormalized from the asset at creation, exactly as the assignment and the
// maintenance order do, so a branch-scoped reader is filtered by the asset's own anchor (§7).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItSoftwareInstallationDoc extends BaseDocFields {
  assetId: Types.ObjectId;
  productId: Types.ObjectId;
  softwareVersion: string | null;
  licenseId: Types.ObjectId | null;
  installedAt: Date;
  removedAt: Date | null;
  branchId: Types.ObjectId;
}

const installationSchema = new Schema<ItSoftwareInstallationDoc>(
  {
    assetId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    softwareVersion: { type: String, default: null },
    licenseId: { type: Schema.Types.ObjectId, default: null },
    installedAt: { type: Date, required: true },
    removedAt: { type: Date, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// THE INVARIANT (§2.8): "One product can appear once per asset while active." A partial unique
// index, not a check — a check produces the good error message, the index is what actually holds
// under two concurrent installs. Exactly the `it_asset_assignments` open-interval precedent.
installationSchema.index(
  { assetId: 1, productId: 1 },
  {
    unique: true,
    name: 'ux_active_per_asset',
    partialFilterExpression: { removedAt: null, isDeleted: false },
  },
);
// `seatsUsed` — the count of live rows per license (FR-10). This index is what makes deriving it
// cheap enough to never need storing.
installationSchema.index({ licenseId: 1, removedAt: 1 }, { name: 'ix_license_active' });
installationSchema.index({ assetId: 1, removedAt: 1 }, { name: 'ix_asset_active' });
installationSchema.index({ branchId: 1, removedAt: 1 }, { name: 'ix_branch_active' });

export const ItSoftwareInstallationModel = model<ItSoftwareInstallationDoc>(
  'ItSoftwareInstallation',
  installationSchema,
  'it_software_installations',
);
