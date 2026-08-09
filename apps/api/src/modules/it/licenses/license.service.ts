// Licences (design §2.8, FR-10, §13-Q5).
//
// Two numbers on every licence are DERIVED and never stored, and this service is where that
// promise is kept:
//
//   * `seatsUsed` — the live installations pointing at the licence. Computed for a whole page in
//     ONE aggregation, because a per-row query is how a derived number ends up cached "for
//     performance" and then drifts.
//   * `state` — a pure function of `expiresAt`, the warn window and the clock (§6: no stored
//     state). Nothing writes it, so nothing can write it wrong.
//
// The licence KEY is stored and returned in plain text under `itLicense.view`. That is §13-Q5's
// adopted decision, not an oversight: masking with a reveal endpoint was considered and rejected
// at design approval.
import { Types } from 'mongoose';
import {
  ItSettingKeys,
  type CreateItLicense,
  type ItLicenseState,
  type ListItLicensesQuery,
  type Paginated,
  type UpdateItLicense,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { settingsService } from '../../../platform/settings';
import { diffChanges } from '../../../shared/utils/diff';
import { itSoftwareProductRepository } from '../software/product.repository';
import { itSoftwareInstallationRepository } from '../software/installation.repository';
import { itVendorRepository } from '../vendors';
import { itLicenseRepository } from './license.repository';
import { licenseState } from './license-state';
import { type ItLicenseDoc, type ItLicensePurchaseSub } from './license.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'license', entityId: id });

/** Organization scope — a warn window is a company policy, not a user preference. */
const ORG = { userId: null, branchId: null };

const snapshot = (doc: ItLicenseDoc) => ({
  productId: String(doc.productId),
  seats: doc.seats,
  expiresAt: doc.expiresAt === null ? null : doc.expiresAt.toISOString(),
  // The key is deliberately ABSENT from the audit diff: an audit trail that copies secrets is a
  // second place to leak them, and `itLicense.view` already governs the real one.
  hasKey: doc.licenseKey !== null,
  notes: doc.notes,
});

const toPurchase = (input: CreateItLicense['purchase']): ItLicensePurchaseSub | null => {
  if (input === undefined) return null;
  return {
    vendorId: input.vendorId === undefined || input.vendorId === null
      ? null
      : new Types.ObjectId(input.vendorId),
    date: input.date ?? null,
    cost: input.cost ?? null,
    invoiceRef: input.invoiceRef ?? null,
  };
};

/** A licence and the two numbers a screen needs but the document does not hold. */
export interface ItLicenseView {
  doc: ItLicenseDoc;
  seatsUsed: number;
  state: ItLicenseState;
}

class ItLicenseService {
  /** The warn window, resolved once per read rather than per row. */
  private async warnDays(): Promise<number> {
    const days = await settingsService.resolve<number>(ItSettingKeys.LicenseWarnDays, ORG);
    return typeof days === 'number' && days >= 0 ? days : 0;
  }

  /** Attach the derived pair to a page of licences — one aggregation, whatever the page size. */
  private async decorate(docs: ItLicenseDoc[], now = new Date()): Promise<ItLicenseView[]> {
    const [used, warn] = await Promise.all([
      itSoftwareInstallationRepository.countActiveByLicense(docs.map((d) => d._id)),
      this.warnDays(),
    ]);
    return docs.map((doc) => ({
      doc,
      seatsUsed: used.get(String(doc._id)) ?? 0,
      state: licenseState(doc.expiresAt, warn, now),
    }));
  }

  private async assertReferences(input: {
    productId?: string | undefined;
    purchase?: { vendorId?: string | null | undefined } | null | undefined;
  }): Promise<void> {
    if (input.productId !== undefined) {
      const product = await itSoftwareProductRepository.findById(input.productId);
      if (product === null || !product.active) {
        throw new BusinessRuleError('productId must reference an active software product');
      }
    }
    const vendorId = input.purchase?.vendorId;
    if (vendorId !== undefined && vendorId !== null) {
      const vendor = await itVendorRepository.findOne({ _id: vendorId, isActive: true });
      if (vendor === null) throw new BusinessRuleError('vendorId must reference an active vendor');
    }
  }

  async create(input: CreateItLicense, ctx: AuthContext): Promise<ItLicenseView> {
    await this.assertReferences(input);
    const doc = await itLicenseRepository.create(
      {
        productId: new Types.ObjectId(input.productId),
        licenseKey: input.licenseKey ?? null,
        seats: input.seats ?? null,
        purchase: toPurchase(input.purchase),
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    const [view] = await this.decorate([doc]);
    // `decorate` maps one-for-one, so a single input yields a single output.
    return view as ItLicenseView;
  }

  /**
   * `state` and `overSeats` filter on DERIVED values, so they are applied after decoration rather
   * than in the query. The page is bounded by `MAX_PAGE_SIZE`, so this filters a page and never a
   * collection — and the alternative, storing either value to make it queryable, is the drift
   * FR-10 exists to prevent.
   */
  async list(query: ListItLicensesQuery, now = new Date()): Promise<Paginated<ItLicenseView>> {
    const page = await itLicenseRepository.listFiltered(query);
    const views = await this.decorate(page.items, now);
    const filtered = views.filter((view) => {
      if (query.state !== undefined && view.state !== query.state) return false;
      if (query.overSeats === true) return view.doc.seats !== null && view.seatsUsed > view.doc.seats;
      return true;
    });
    return { items: filtered, meta: page.meta };
  }

  async getById(id: string, now = new Date()): Promise<ItLicenseView> {
    const doc = await itLicenseRepository.getById(id);
    const [view] = await this.decorate([doc], now);
    return view as ItLicenseView;
  }

  async update(id: string, input: UpdateItLicense, ctx: AuthContext): Promise<ItLicenseView> {
    const before = await itLicenseRepository.getById(id);
    if (input.purchase !== undefined && input.purchase !== null) {
      await this.assertReferences({ purchase: input.purchase });
    }

    const set: Partial<ItLicenseDoc> = {};
    if (input.licenseKey !== undefined) set.licenseKey = input.licenseKey;
    if (input.seats !== undefined) set.seats = input.seats;
    if (input.expiresAt !== undefined) set.expiresAt = input.expiresAt;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.purchase !== undefined) {
      set.purchase = input.purchase === null ? null : toPurchase(input.purchase);
    }

    const updated = await itLicenseRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    const [view] = await this.decorate([updated]);
    return view as ItLicenseView;
  }
}

export const itLicenseService = new ItLicenseService();
