import { Types, type FilterQuery, type UpdateQuery } from 'mongoose';
import { ADMINISTRATION_MAX_LIST_ATTACHMENTS, CONTENT_EDITABLE } from '@ecms/contracts';
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
  type AdministrationPurchaseRequestAttachmentSub,
  type AdministrationPurchaseRequestDoc,
} from './purchase-request.model';
import { invalidTransition } from './purchase-request-rules';

/** The list's last slot: while it is empty, the list holds fewer than the bound (design §11.4). */
const LAST_SLOT = `attachments.${String(ADMINISTRATION_MAX_LIST_ATTACHMENTS - 1)}`;

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

  // ── A request's files (P2.6; P2 plan §4.3) ─────────────────────────────────

  /**
   * Link one file: ONE write that holds the version the requester saw, the draft status and the
   * list's bound in its filter, so a stale view, a submitted request and a 21st file are refused
   * even when two adds race. Null when it matched nothing; the caller re-reads to say why.
   */
  async pushAttachment(
    id: string,
    version: number,
    entry: AdministrationPurchaseRequestAttachmentSub,
    by: string,
    scope: ScopeSelector,
  ): Promise<AdministrationPurchaseRequestDoc | null> {
    return this.linkWrite(
      id,
      version,
      { [LAST_SLOT]: { $exists: false } },
      { $push: { attachments: entry } },
      by,
      scope,
    );
  }

  /** Unlink one file, under the version the requester saw, while a draft. Null when it missed. */
  async pullAttachment(
    id: string,
    version: number,
    attachmentId: Types.ObjectId,
    by: string,
    scope: ScopeSelector,
  ): Promise<AdministrationPurchaseRequestDoc | null> {
    return this.linkWrite(
      id,
      version,
      { 'attachments.attachmentId': attachmentId },
      { $pull: { attachments: { attachmentId } } },
      by,
      scope,
    );
  }

  /**
   * A link write is an edit of the draft (design §11.4): version-held, it moves the version, so an
   * edit decided before it is answered as stale; `writeConditions()` keeps it to a draft, as on
   * every content write; and the scope is the write key's that found the request, so the filter
   * reaches no row its load could not. It writes the list alone — never the status.
   */
  private async linkWrite(
    id: string,
    version: number,
    condition: FilterQuery<AdministrationPurchaseRequestDoc>,
    change: UpdateQuery<AdministrationPurchaseRequestDoc>,
    by: string,
    scope: ScopeSelector,
  ): Promise<AdministrationPurchaseRequestDoc | null> {
    return this.model
      .findOneAndUpdate(
        this.baseFilter(scope, {
          _id: new Types.ObjectId(id),
          __v: version,
          ...condition,
          ...this.writeConditions(),
        }),
        { ...change, $set: { updatedBy: new Types.ObjectId(by) }, $inc: { __v: 1 } },
        { new: true },
      )
      .lean<AdministrationPurchaseRequestDoc>()
      .exec();
  }
}

export const administrationPurchaseRequestRepository =
  new AdministrationPurchaseRequestRepository();
