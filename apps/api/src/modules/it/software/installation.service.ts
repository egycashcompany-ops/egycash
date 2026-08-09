// Installations (design §2.8, §4.7-adjacent, FR-10).
//
// Two rules carry this file, and both are the design's:
//
//   1. **One product per asset while active.** Enforced by the partial unique index — the check
//      below only produces the readable error. Two concurrent installs cannot both win.
//   2. **A seat overrun WARNS and never blocks** (FR-10, §13-Q5). The count is taken AFTER the
//      write, inside the transaction, and the event is emitted after the commit: a technician
//      mid-install is the wrong person to stop, and compliance is a screen someone watches.
//
// Removal stamps `removedAt` and keeps the row. The register has to be able to answer "what was on
// this machine last year", which a delete would erase — the `it_asset_assignments` argument again.
import { Types } from 'mongoose';
import {
  ItEvents,
  type CreateItSoftwareInstallation,
  type ListItSoftwareInstallationsQuery,
  type Paginated,
  type RemoveItSoftwareInstallation,
  type UpdateItSoftwareInstallation,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector, scopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { itAssetRepository } from '../assets/asset.repository';
import { itSoftwareProductRepository } from './product.repository';
import { itLicenseRepository } from '../licenses/license.repository';
import { itSoftwareInstallationRepository } from './installation.repository';
import { type ItSoftwareInstallationDoc } from './installation.model';

const entityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'softwareInstallation',
  entityId: id,
});

const change = (field: string, from: unknown, to: unknown) => ({ field, old: from, new: to });

/**
 * Installations read and write under the SOFTWARE grant's scope.
 *
 * Holding `itSoftware.manage` never widens which assets you can reach: the asset itself is loaded
 * through this selector, so a branch-scoped installer sees a 422 for another branch's machine
 * exactly as they would for one that does not exist.
 */
const softwareScope = (ctx: AuthContext): ScopeSelector => scopeSelector(ctx, 'itSoftware.view');

/** The seat warning, decided from facts and emitted by the caller after ITS commit. */
interface SeatWarning {
  licenseId: string;
  productId: string;
  productName: string;
  seats: number;
  seatsUsed: number;
}

class ItSoftwareInstallationService {
  async list(
    query: ListItSoftwareInstallationsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItSoftwareInstallationDoc>> {
    return itSoftwareInstallationRepository.listFiltered(query, scope);
  }

  async getById(id: string, scope: ScopeSelector): Promise<ItSoftwareInstallationDoc> {
    return itSoftwareInstallationRepository.getById(id, scope);
  }

  /**
   * Record an install.
   *
   * The licence is optional: plenty of software is free, and forcing a licence would make the
   * register lie about what is actually on the machine.
   */
  async create(
    input: CreateItSoftwareInstallation,
    ctx: AuthContext,
  ): Promise<ItSoftwareInstallationDoc> {
    const scope = softwareScope(ctx);
    const asset = await itAssetRepository.findById(input.assetId, scope);
    if (asset === null) throw new BusinessRuleError('assetId must reference a visible asset');
    if (asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed and accepts no further operation (FR-4)`,
      );
    }
    const product = await itSoftwareProductRepository.findById(input.productId);
    if (product === null || !product.active) {
      throw new BusinessRuleError('productId must reference an active software product');
    }
    if (input.licenseId !== undefined) {
      const license = await itLicenseRepository.findById(input.licenseId);
      if (license === null) throw new BusinessRuleError('licenseId must reference a licence');
      if (String(license.productId) !== input.productId) {
        // A licence entitles ONE product. Consuming a seat of the wrong one would make every seat
        // count in the system meaningless.
        throw new BusinessRuleError('the licence belongs to a different product');
      }
    }

    // The readable error for the invariant the index actually holds.
    const already = await itSoftwareInstallationRepository.findOne({
      assetId: new Types.ObjectId(input.assetId),
      productId: new Types.ObjectId(input.productId),
      removedAt: null,
    });
    if (already !== null) {
      throw new ConflictError(
        `${product.name} is already installed on ${asset.assetCode}; remove it first`,
      );
    }

    const at = input.installedAt ?? new Date();
    const result = await unitOfWork(async (session) => {
      const doc = await itSoftwareInstallationRepository.create(
        {
          assetId: new Types.ObjectId(input.assetId),
          productId: new Types.ObjectId(input.productId),
          softwareVersion: input.softwareVersion ?? null,
          licenseId: input.licenseId === undefined ? null : new Types.ObjectId(input.licenseId),
          installedAt: at,
          removedAt: null,
          branchId: asset.branchId,
        },
        { by: ctx.userId, session },
      );

      // FR-10: counted AFTER the write and inside it, so the number announced is the number the
      // store actually reached — never a prediction, and never a gate.
      let warning: SeatWarning | null = null;
      if (doc.licenseId !== null) {
        const license = await itLicenseRepository.findById(String(doc.licenseId));
        if (license !== null && license.seats !== null) {
          const used = await itSoftwareInstallationRepository.countActiveForLicense(
            doc.licenseId,
            session,
          );
          if (used > license.seats) {
            warning = {
              licenseId: String(license._id),
              productId: String(license.productId),
              productName: product.name,
              seats: license.seats,
              seatsUsed: used,
            };
          }
        }
      }

      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: [
          change('assetId', null, input.assetId),
          change('productId', null, input.productId),
          change('licenseId', null, doc.licenseId === null ? null : String(doc.licenseId)),
        ],
      });
      return { doc, warning };
    });

    if (result.warning !== null) await emit(ItEvents.LicenseSeatsExceeded, result.warning);
    return result.doc;
  }

  /** Edit the two fields an install can legitimately get wrong: its version and its licence. */
  async update(
    id: string,
    input: UpdateItSoftwareInstallation,
    ctx: AuthContext,
  ): Promise<ItSoftwareInstallationDoc> {
    const scope = softwareScope(ctx);
    const before = await itSoftwareInstallationRepository.getById(id, scope);
    if (before.removedAt !== null) {
      throw new BusinessRuleError('a removed installation is a finished record and cannot be edited');
    }
    if (input.licenseId !== undefined && input.licenseId !== null) {
      const license = await itLicenseRepository.findById(input.licenseId);
      if (license === null) throw new BusinessRuleError('licenseId must reference a licence');
      if (String(license.productId) !== String(before.productId)) {
        throw new BusinessRuleError('the licence belongs to a different product');
      }
    }

    const set: Partial<ItSoftwareInstallationDoc> = {};
    if (input.softwareVersion !== undefined) set.softwareVersion = input.softwareVersion;
    if (input.licenseId !== undefined) {
      set.licenseId = input.licenseId === null ? null : new Types.ObjectId(input.licenseId);
    }

    const updated = await itSoftwareInstallationRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        change('softwareVersion', before.softwareVersion, updated.softwareVersion),
        change(
          'licenseId',
          before.licenseId === null ? null : String(before.licenseId),
          updated.licenseId === null ? null : String(updated.licenseId),
        ),
      ],
    });
    return updated;
  }

  /**
   * Remove: stamps `removedAt` and frees the seat. A named action, never a PATCH — uninstalling is
   * a distinct operational act, and the row it ends is a business record, not a draft.
   */
  async remove(
    id: string,
    input: RemoveItSoftwareInstallation,
    ctx: AuthContext,
  ): Promise<ItSoftwareInstallationDoc> {
    const scope = softwareScope(ctx);
    const at = input.removedAt ?? new Date();
    return unitOfWork(async (session) => {
      const before = await itSoftwareInstallationRepository.getByIdForUpdate(id, scope, session);
      if (before.removedAt !== null) {
        throw new ConflictError('this installation was already removed');
      }
      if (at.getTime() < before.installedAt.getTime()) {
        throw new BusinessRuleError('the removal cannot precede the installation it ends');
      }

      const updated = await itSoftwareInstallationRepository.updateById(
        id,
        { removedAt: at },
        { by: ctx.userId, version: before.__v, session, scope },
      );
      await auditService.record({
        entityRef: entityRef(id),
        // `archive` rather than a new word: the row is folded away, not deleted, and the closed
        // vocabulary already means exactly that.
        action: 'archive',
        changes: [change('removedAt', null, at.toISOString()), change('note', null, input.note ?? null)],
      });
      return updated;
    });
  }
}

export const itSoftwareInstallationService = new ItSoftwareInstallationService();
