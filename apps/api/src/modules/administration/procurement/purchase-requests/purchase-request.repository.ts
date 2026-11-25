import { Types, type FilterQuery } from 'mongoose';
import { CONTENT_EDITABLE } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { collectionReady } from '../../shared/collection-ready';
import {
  highestNumberPipeline,
  numberFloorFrom,
  type DocumentNumberSeries,
} from '../../shared/document-number';
import { statusesWhere } from '../../shared/lifecycle';
import {
  AdministrationPurchaseRequestModel,
  type AdministrationPurchaseRequestDoc,
} from './purchase-request.model';
import { invalidTransition } from './purchase-request-rules';

class AdministrationPurchaseRequestRepository extends BaseRepository<AdministrationPurchaseRequestDoc> {
  /** Awaited before every write: `ux_number` is what two submissions taking one number meet. */
  readonly ensureCollection = collectionReady(AdministrationPurchaseRequestModel);

  constructor() {
    super(AdministrationPurchaseRequestModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      ownerUserField: 'requesterUserId',
    }); // a document of its requester's department copy, in that copy's branch (§7.1)
  }

  /**
   * A `section` grant reads as `own` (design §7.3). A request carries no section, and over a
   * collection with no section field the base repository answers `section` with `{}`, the whole
   * organization; read as `own`, the grant fails closed to the caller's own requests. Every other
   * scope is the base's: organization (narrowed by the top bar), branch, department copy, and
   * `own` as the rows the caller created or requested.
   */
  protected override scopeFilter(
    selector: ScopeSelector | undefined,
  ): FilterQuery<AdministrationPurchaseRequestDoc> {
    if (selector?.scope === 'section') return super.scopeFilter({ ...selector, scope: 'own' });
    return super.scopeFilter(selector);
  }

  /**
   * Content moves only while the request is a draft (design §5.1.4): riding inside the same
   * atomic write as every edit, so a submission landing a moment earlier cannot be overtaken by an
   * edit read before it. Built from the guard set, so the filter and the set agree.
   */
  protected override writeConditions(): FilterQuery<AdministrationPurchaseRequestDoc> {
    return { status: { $in: statusesWhere(CONTENT_EDITABLE) } };
  }

  /** A write the draft condition excluded: the real reason, before a stale version is reported. */
  protected override assertWritable(current: AdministrationPurchaseRequestDoc): void {
    if (!CONTENT_EDITABLE[current.status]) throw invalidTransition(current.status);
  }

  /**
   * The sequence of the series' highest number already taken, deleted rows included — a number is
   * never reused — and 0 before the first: the yearly counter's floor (P2 plan §6.3).
   */
  async highestNumber(series: DocumentNumberSeries): Promise<number> {
    const rows = await this.model
      .aggregate<{ top?: unknown }>(highestNumberPipeline(series))
      .exec();
    return numberFloorFrom(series, rows);
  }

  /**
   * Whether a line of a request that had an effect names the item: every request but a cancelled
   * draft that never took a number. Such a draft decided nothing, and a draft re-reads its items'
   * units on every save, so an abandoned one does not fix a wrong unit for ever (P2 plan §6.2).
   * Scans `lines.itemId` with no index: its only caller is an item edit that changes the unit.
   */
  async namesItem(itemId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(itemId)) return false;
    return this.exists({
      'lines.itemId': new Types.ObjectId(itemId),
      $nor: [{ status: 'cancelled', number: null }],
    });
  }
}

export const administrationPurchaseRequestRepository =
  new AdministrationPurchaseRequestRepository();
