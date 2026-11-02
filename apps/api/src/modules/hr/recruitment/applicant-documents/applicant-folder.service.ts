// The Applicant documents page's folders: one per applicant, holding everything kept for them.
//
// Nothing is stored twice to make a folder. A folder is a VIEW over the files the system already
// keeps against the applicant — the National-ID card filed at registration (front, back and the
// holder's photo, told apart by their tags), the attachments HR added on the applicant's page, and
// the documents the candidate handed in through the portal — read through the Files service, whose
// own rules still decide who may open or download each one.
import {
  ErrorCodes,
  nationalIdCardTag,
  type ApplicantFolderDeleteBlock,
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type ApplicantFolderFileDto,
  type ApplicantFolderFileKind,
  type DeleteApplicantFoldersResultDto,
  type DeletedApplicantFolderDto,
  type FileDto,
  type ListApplicantFoldersQuery,
  type LocalizedString,
  type RefusedApplicantFolderDto,
} from '@ecms/contracts';
import { type FilterQuery, type Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { auditService } from '../../../../platform/audit';
import { fileService, type FileAccessIntent, type FileDoc } from '../../../../platform/files';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../../shared/errors';
import { normalizeArabic } from '../../shared/arabic';
import { ApplicantModel, type ApplicantDoc } from '../applicants/applicant.model';
import { applicantRepository } from '../applicants/applicant.repository';
import { resolveNationalIdCardCategoryId } from '../applicants/national-id-card.files';
// The two repository FILES and not their barrels. `employee-management/employees/index.ts`
// re-exports `employeeService`, which imports the applicants barrel — an import cycle whose
// symptom is an undefined binding at module load rather than a compile error. `job-offers/index.ts`
// does not export its repository at all; `employee.migration.ts` documents the same dodge.
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { jobOfferRepository } from '../job-offers/job-offer.repository';
import { APPLICANT_DOCUMENT_ENTITY_TYPE } from './applicant-document.files';
import {
  ApplicantDocumentSetModel,
  type ApplicantDocumentSetDoc,
} from './applicant-document.model';
import { applicantDocumentRepository } from './applicant-document.repository';

/**
 * Files carry no branch of their own; the folder is reached through the applicant, so the file
 * query is not narrowed again. (Opening a file's bytes is still checked by the Files service.)
 *
 * This is the SCOPE and not the authorization. Every listing below also passes the caller, so
 * ADR-023 asks the owning module about each file — see `filesOf`.
 */
const FILES_UNSCOPED: ScopeSelector = {
  scope: 'organization',
  userId: '',
  branchId: null,
  departmentId: null,
  sectionId: null,
};

/**
 * How many files one request asks for, and how many requests a folder may take.
 *
 * The limit exists so a bug upstream cannot turn a folder read into an unbounded loop; at this
 * page size it allows ten thousand files against one applicant, which is three orders of magnitude
 * past anything real.
 */
const FOLDER_PAGE_SIZE = 100;
const FOLDER_PAGE_LIMIT = 100;

/** Order inside a folder: the card's sides and the face first, then everything else. */
const KIND_ORDER: Record<ApplicantFolderFileKind, number> = {
  cardFront: 0,
  cardBack: 1,
  portrait: 2,
  card: 3,
  attachment: 4,
  document: 5,
};

const escapeRegex = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The two entity types a folder is made of: what HR filed against the applicant, and what the
 * candidate handed in through the portal. Named once because two different questions ask it — what
 * is IN a folder, and whether a folder is empty.
 */
const FOLDER_ENTITY_TYPES = ['applicant', APPLICANT_DOCUMENT_ENTITY_TYPE] as const;

/** What a caller wants done beyond emptying the folder. */
export interface FolderDeleteOptions {
  /**
   * Withdraw the application too, with this reason, under the caller's OWN applicant scope.
   *
   * The scope is the caller's rather than the folder service's because withdrawing is the
   * applicants module's act: a caller who may empty folders across the company but whose applicant
   * reach is one branch must not reach past it here, and passing their real selector is what makes
   * that true rather than merely intended.
   */
  withdraw: { reason: string; scope: ScopeSelector } | null;
}

class ApplicantFolderService {
  /**
   * Every live file kept against one applicant, whichever feature filed it.
   *
   * PAGED TO EXHAUSTION, not capped at one page. It used to ask for a hundred and take whatever
   * came back, which reads as a generous limit until a folder holds a hundred and one: the count
   * on the shelf would then be wrong, the last file would be invisible, and — once the folder can
   * be DELETED — the files past the cap would survive a delete that reported success. A folder has
   * no natural size, so the only safe bound is the one the data sets.
   */
  private async filesOf(
    applicantId: string,
    ctx: AuthContext,
    intent: FileAccessIntent,
  ): Promise<FileDoc[]> {
    const out: FileDoc[] = [];
    for (let page = 1; page <= FOLDER_PAGE_LIMIT; page += 1) {
      const result = await fileService.list(
        {
          moduleId: 'hr',
          entityId: applicantId,
          page,
          pageSize: FOLDER_PAGE_SIZE,
          sortDir: 'desc',
        },
        FILES_UNSCOPED,
        ctx,
        intent,
      );
      out.push(...result.items);
      if (result.items.length < FOLDER_PAGE_SIZE) break;
    }
    return out.filter((f) =>
      (FOLDER_ENTITY_TYPES as readonly string[]).includes(f.entityRef.entityType),
    );
  }

  /**
   * The catalogue type each handed-in document was filed for, by file id.
   *
   * One query per folder, against the unique `applicantId` index — the set row already mirrors
   * every portal upload, so naming the files costs a lookup rather than a join per file.
   */
  private async documentTypesOf(applicantId: string): Promise<Map<string, LocalizedString>> {
    const set = await ApplicantDocumentSetModel.findOne({ applicantId, isDeleted: false })
      .select({ documents: 1 })
      .lean<Pick<ApplicantDocumentSetDoc, 'documents'>>()
      .exec();
    return new Map(
      (set?.documents ?? []).map((item) => [String(item.fileId), item.typeName] as const),
    );
  }

  private kindOf(file: FileDoc, cardCategoryId: string): ApplicantFolderFileKind {
    if (file.entityRef.entityType === APPLICANT_DOCUMENT_ENTITY_TYPE) return 'document';
    if (String(file.categoryId) !== cardCategoryId) return 'attachment';
    if (file.tags.includes(nationalIdCardTag('front'))) return 'cardFront';
    if (file.tags.includes(nationalIdCardTag('back'))) return 'cardBack';
    if (file.tags.includes(nationalIdCardTag('portrait'))) return 'portrait';
    return 'card';
  }

  private summary(
    applicant: ApplicantDoc,
    files: { kind: ApplicantFolderFileKind; file: FileDoc }[],
    deleteBlock: ApplicantFolderDeleteBlock | null,
  ): ApplicantFolderDto {
    const portrait = files.find((f) => f.kind === 'portrait');
    return {
      applicantId: String(applicant._id),
      applicantCode: applicant.code,
      applicantName: applicant.fullNameAr,
      fileCount: files.length,
      hasCard: files.some(
        (f) => f.kind === 'cardFront' || f.kind === 'cardBack' || f.kind === 'card',
      ),
      portraitFileId: portrait === undefined ? null : String(portrait.file._id),
      registeredAt: applicant.createdAt.toISOString(),
      deleteBlock,
    };
  }

  /**
   * Which of these applicants' folders are KEPT RECORDS, and why.
   *
   * Three clauses, each independently load-bearing, asked about a whole page in two queries:
   *
   *   • `status === 'hired'` — the terminal success state, and free: the applicant document is
   *     already in hand.
   *   • an employee row carrying this `applicantId` — the committed fact, and the clause that
   *     actually matters. `employeeService.nationalIdCard` COPIES the card out of the applicant's
   *     folder the first time anybody opens an employee's card and finds none of their own, and it
   *     keeps doing that for as long as the person works here. So deleting the folder of somebody
   *     already on the payroll can destroy the only copy of their card, years after the hire and
   *     without a word. The status alone would not catch it: the hire writes the employee row
   *     inside a transaction and raises the lifecycle event after it, so an employee can exist
   *     with the applicant still `new`.
   *   • an accepted, non-superseded offer — the window between accepting and the employee row
   *     existing, where neither clause above is true yet and the card is about to be copied.
   *
   * The clauses are tried in that order, so the most definite explanation is the one reported.
   */
  private async blocksFor(
    applicants: readonly ApplicantDoc[],
  ): Promise<Map<string, ApplicantFolderDeleteBlock>> {
    const blocks = new Map<string, ApplicantFolderDeleteBlock>();
    const ids = applicants.map((a) => String(a._id));
    if (ids.length === 0) return blocks;
    const [employed, offered] = await Promise.all([
      employeeRepository.findApplicantIdsWithEmployeeSystem(ids),
      jobOfferRepository.findApplicantIdsWithAcceptedOffer(ids),
    ]);
    for (const applicant of applicants) {
      const id = String(applicant._id);
      if (applicant.status === 'hired') blocks.set(id, 'hired');
      else if (employed.has(id)) blocks.set(id, 'employed');
      else if (offered.has(id)) blocks.set(id, 'acceptedOffer');
    }
    return blocks;
  }

  private async classified(
    applicantId: string,
    ctx: AuthContext,
    intent: FileAccessIntent,
  ): Promise<{ kind: ApplicantFolderFileKind; file: FileDoc }[]> {
    const cardCategoryId = await resolveNationalIdCardCategoryId();
    return (await this.filesOf(applicantId, ctx, intent))
      .map((file) => ({ kind: this.kindOf(file, cardCategoryId), file }))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }

  /**
   * The folders HR emptied and nobody has filed anything for since.
   *
   * These leave the grid. An emptied folder sitting there as a nought-file shelf is the thing this
   * exists to prevent — HR removed it, so the shelf should be gone, not blank.
   *
   * TWO QUERIES, AND THE SECOND IS THE ONE THAT MATTERS. The marker alone would be a lie waiting
   * to happen: file a new document for someone whose folder was emptied last year and the marker
   * still says «emptied», so their folder would stay invisible while holding their papers. So the
   * marker only NOMINATES a folder for hiding and the files have the final say — asked of the
   * Files service, which is the same source the count on the shelf comes from. Nothing has to be
   * reset when a folder fills up again; it simply stops being hidden.
   *
   * It is computed against the SAME filter as the page, so the set is bounded by what the search
   * already narrowed to, and it is applied BEFORE `skip`/`limit` — filtering a page after the fact
   * would leave ragged pages, a total that counts folders nobody can see, and, with enough emptied
   * folders, a page that comes back blank while later pages have folders on them.
   */
  private async hiddenFolderIds(
    filter: FilterQuery<ApplicantDoc>,
  ): Promise<Types.ObjectId[]> {
    const nominated = await ApplicantModel.find({
      ...filter,
      // Spelled `$type` and not `$ne: null` so `ix_documentsFolderDeletedAt` — a partial index
      // holding only the emptied folders — is provably usable. See the index's own note.
      documentsFolderDeletedAt: { $type: 'date' },
    })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    if (nominated.length === 0) return [];
    const refilled = await fileService.entityIdsWithLiveFiles(
      'hr',
      FOLDER_ENTITY_TYPES,
      nominated.map((row) => String(row._id)),
    );
    return nominated.filter((row) => !refilled.has(String(row._id))).map((row) => row._id);
  }

  /** The folders, newest applicant first, narrowed by name, code or national ID. */
  async list(
    ctx: AuthContext,
    query: ListApplicantFoldersQuery,
  ): Promise<{ items: ApplicantFolderDto[]; total: number }> {
    const filter: FilterQuery<ApplicantDoc> = { isDeleted: false };
    const search = query.search?.trim() ?? '';
    if (search !== '') {
      const digits = search.replace(/\D/g, '');
      filter.$or = [
        { searchName: new RegExp(escapeRegex(normalizeArabic(search)), 'i') },
        { fullNameEn: new RegExp(escapeRegex(search), 'i') },
        { code: new RegExp(escapeRegex(search), 'i') },
        ...(digits.length === 14 ? [{ nationalId: digits }] : []),
      ];
    }
    const hidden = await this.hiddenFolderIds(filter);
    if (hidden.length > 0) filter._id = { $nin: hidden };
    const [applicants, total] = await Promise.all([
      ApplicantModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ApplicantDoc[]>()
        .exec(),
      ApplicantModel.countDocuments(filter).exec(),
    ]);
    const blocks = await this.blocksFor(applicants);
    const items = await Promise.all(
      applicants.map(async (a) =>
        this.summary(
          a,
          await this.classified(String(a._id), ctx, 'read'),
          blocks.get(String(a._id)) ?? null,
        ),
      ),
    );
    return { items, total };
  }

  /** One applicant's folder, with every file in it the caller may see. */
  async get(ctx: AuthContext, applicantId: string): Promise<ApplicantFolderDetailDto> {
    const applicant = await ApplicantModel.findOne({ _id: applicantId, isDeleted: false })
      .lean<ApplicantDoc>()
      .exec();
    if (applicant === null) throw new NotFoundError();
    const [files, types, blocks] = await Promise.all([
      this.classified(applicantId, ctx, 'read'),
      this.documentTypesOf(applicantId),
      this.blocksFor([applicant]),
    ]);
    return {
      ...this.summary(applicant, files, blocks.get(applicantId) ?? null),
      files: files.map(({ kind, file }): ApplicantFolderFileDto => ({
        kind,
        file: fileService.toDto(file) as FileDto,
        documentType: types.get(String(file._id)) ?? null,
      })),
    };
  }

  // ── Emptying a folder ────────────────────────────────────────────────────

  /**
   * Remove every file this folder shows, for an applicant already checked.
   *
   * ORDER MATTERS: the POINTERS go before the BYTES. The set row mirrors each handed-in document's
   * `fileId`, and a row still naming a file nobody can open is worse than no row — the reviewer's
   * queue goes on showing the document as waiting, and the candidate's next attempt at that slot
   * is refused by a guard that says the slot is taken. Dropping the set first means a half-finished
   * delete leaves the slot empty and re-uploadable rather than bricked.
   *
   * Each file is removed on its own account and a failure is counted, not thrown: the soft delete
   * takes no session, so the whole thing cannot be one transaction, and stopping at the first
   * refusal would leave a folder half emptied with no way to finish the job. Re-running it is
   * safe — an already-deleted file simply does not count again.
   */
  private async removeFiles(
    ctx: AuthContext,
    applicant: ApplicantDoc,
    options: FolderDeleteOptions,
  ): Promise<DeletedApplicantFolderDto> {
    const applicantId = String(applicant._id);
    await applicantDocumentRepository.softDeleteForApplicant(applicantId, ctx.userId);
    // Asked with the DELETE intent, which is what this caller is about to do. Asking to READ would
    // hand back only the files a REVIEWER may open — the candidate's own handed-in documents are
    // guarded on `applicantDocument.review` — so an emptier holding `applicantDocument.delete` and
    // not the reviewer's key would empty a folder that still held every document the candidate
    // submitted, having just dropped the set rows that pointed at them. Each file is still
    // authorized on its own account when `softDelete` removes it.
    const files = await this.classified(applicantId, ctx, 'delete');
    let filesRemoved = 0;
    for (const { file } of files) {
      const removed = await fileService
        .softDelete(ctx, String(file._id))
        .then(() => true)
        .catch(() => false);
      if (removed) filesRemoved += 1;
    }
    // Nothing is filed against the applicant any more, so the counter on their own page is zero,
    // and this folder is now an emptied one rather than an empty one — which is what takes it off
    // the folders grid instead of leaving a nought-file shelf behind.
    await applicantRepository.markDocumentsFolderEmptied(applicantId);
    // ONE row for the act, beside the platform's own row per file. The per-file rows answer «what
    // happened to this file»; this one answers «who emptied this person's folder, and when», which
    // is the question an HR review actually asks and which no amount of reading N file rows makes
    // obvious. The actor, the time and the request id come from the ambient request context.
    //
    // `applicantFolderDeleted` and NOT `delete`: the audit screen labels `delete` «حُذف الحساب»,
    // and nothing about this act deletes the applicant — while `delete` is a broadcast action, so
    // a row carrying it would announce to every open applicant screen that this candidate was
    // deleted. Nothing is written here that masking would have to hide: a code and two counts.
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'applicant', entityId: applicantId },
      action: 'applicantFolderDeleted',
      changes: [
        { field: 'documentsFolder', old: `${String(files.length)} files`, new: null },
        { field: 'filesRemoved', old: null, new: filesRemoved },
        { field: 'applicantCode', old: null, new: applicant.code },
      ],
    });
    return {
      applicantId,
      applicantCode: applicant.code,
      applicantName: applicant.fullNameAr,
      filesRemoved,
      // AFTER the files, deliberately. Emptying the folder is what was asked for; withdrawing is
      // the second half of the same intention but it can fail on its own account — a stale version,
      // a lifecycle that will not make the move from where this candidate stands — and none of
      // that is a reason to leave the papers in place.
      withdrawn: await this.withdrawApplication(ctx, applicant, options.withdraw),
    };
  }

  /**
   * Withdraw the application as well, when that was asked for.
   *
   * It goes through `applicantService.withdraw`, so this adds NOTHING to the lifecycle: the
   * version check, the engine's propagation onto the stage records, the `statusChange` audit row
   * and the `hr.applicant.withdrawn` event are all the applicants module's, exactly as they are
   * when somebody presses Withdraw on the applicant's own page.
   *
   * A FAILURE IS REPORTED, NOT RAISED. The files are already gone by the time this runs, so
   * throwing would answer a request that half succeeded with an error that reads as though nothing
   * had — and in a selection of twelve it would abandon the other eleven. Instead the caller gets
   * `withdrawn: false` for this applicant, the screen counts the withdrawals beside the emptied
   * folders so a shortfall is visible, and the reason lands in the log rather than nowhere.
   *
   * Already withdrawn counts as withdrawn: the transition is idempotent and says so by returning
   * the applicant untouched, so reporting `false` here would describe a problem that is not one.
   */
  private async withdrawApplication(
    ctx: AuthContext,
    applicant: ApplicantDoc,
    withdraw: FolderDeleteOptions['withdraw'],
  ): Promise<boolean> {
    if (withdraw === null) return false;
    // READ FRESH, and not from the document this delete started with. The lifecycle matches on
    // `__v` and throws when it misses, and by the time this runs the folder's own writes have all
    // happened — so a version carried in from the top would only ever be as good as the assumption
    // that none of them touched the applicant, and in a selection of fifty it would also be as old
    // as forty-nine deletions ago. Reading it here makes the check mean what it says: refuse if
    // somebody ELSE moved this applicant while we were working. The status comes along for the
    // same reason.
    const current = await ApplicantModel.findOne({ _id: applicant._id, isDeleted: false })
      .select({ __v: 1, status: 1 })
      .lean<{ __v: number; status: string }>()
      .exec();
    if (current === null) return false;
    if (current.status === 'withdrawn') return true;
    try {
      // LOADED DYNAMICALLY, and not out of taste. A static import of the applicants service from
      // this file puts the applicant stage's whole dependency tree in front of this module at load
      // time, and that tree reaches the platform's organization and directory services, which
      // import each other — entering that pair through a new door leaves one of them half built
      // and its index helper undefined. Deferring the import to the first withdrawal keeps the
      // graph acyclic at load, the same trick the workflow envelope uses to reach the stage
      // counters. The import itself is memoized by the module system, so this costs nothing twice.
      //
      // The SERVICE and not the repository: withdrawing is a LIFECYCLE move. The engine propagates
      // it onto the stage records, writes the `statusChange` row and raises the event — a
      // repository write would set a column and leave a withdrawn candidate matching every stage
      // queue (I13/I14).
      const { applicantService } = await import('../applicants/applicant.service');
      await applicantService.withdraw(
        ctx,
        String(applicant._id),
        { reason: withdraw.reason, version: current.__v },
        withdraw.scope,
      );
      return true;
    } catch (error) {
      logger.warn(
        { err: error, applicantId: String(applicant._id), code: applicant.code },
        'documents folder emptied; the application was not withdrawn with it',
      );
      return false;
    }
  }

  /**
   * Withdrawing needs the applicants module's own key, and it is checked HERE.
   *
   * `applicantDocument.delete` buys the right to empty a folder, not the right to move somebody's
   * application to a terminal state — those are different acts with different keys, and the screen
   * only offers the tick-box to a caller holding both. A request that asks for a withdrawal it may
   * not perform is refused WHOLE rather than half-done: silently emptying the folder and skipping
   * the withdrawal would answer «delete and withdraw» with «deleted», which the caller would have
   * no way to notice.
   */
  private assertMayWithdraw(ctx: AuthContext, options: FolderDeleteOptions): void {
    if (options.withdraw === null) return;
    if (!hasPermission(ctx, 'applicant.edit')) {
      throw new ForbiddenError('withdrawing an application requires applicant.edit');
    }
  }

  /** The sentence a refusal carries, so the API says why and not merely no. */
  private refuse(reason: ApplicantFolderDeleteBlock): never {
    const why: Record<ApplicantFolderDeleteBlock, string> = {
      hired: 'this applicant was hired — their documents folder is a kept record',
      employed:
        'an employee record was created from this applicant — their card is still read from this folder',
      acceptedOffer:
        'this applicant holds an accepted offer and is being hired — their card is about to be needed',
    };
    throw new BusinessRuleError(why[reason], ErrorCodes.APPLICANT_FOLDER_KEPT_RECORD);
  }

  /** Empty ONE folder. Refuses a kept record, and says which rule refused it. */
  async deleteFolder(
    ctx: AuthContext,
    applicantId: string,
    options: FolderDeleteOptions = { withdraw: null },
  ): Promise<DeletedApplicantFolderDto> {
    this.assertMayWithdraw(ctx, options);
    const applicant = await ApplicantModel.findOne({ _id: applicantId, isDeleted: false })
      .lean<ApplicantDoc>()
      .exec();
    if (applicant === null) throw new NotFoundError();
    const block = (await this.blocksFor([applicant])).get(applicantId);
    if (block !== undefined) this.refuse(block);
    return this.removeFiles(ctx, applicant, options);
  }

  /**
   * Empty SEVERAL folders, and report per applicant.
   *
   * PARTIAL ON PURPOSE. A selection of twelve holding one hired candidate empties the other eleven
   * and names the one it would not touch. Refusing the whole request would leave the caller to
   * pick their own selection apart to find out which row was the problem — and they would then
   * tick the other eleven again and send exactly this request.
   *
   * An id that names no applicant appears in neither list: there is no folder there to empty and
   * nothing to refuse.
   *
   * A REFUSED FOLDER IS NOT WITHDRAWN EITHER. The refusal is «this person's papers are a kept
   * record», which is said of people who were hired or are being hired — withdrawing them would
   * be the opposite of true, and it is the one thing worse here than doing nothing. Because the
   * withdrawal rides along inside `removeFiles`, a refused applicant cannot reach it.
   */
  async deleteFolders(
    ctx: AuthContext,
    applicantIds: readonly string[],
    options: FolderDeleteOptions = { withdraw: null },
  ): Promise<DeleteApplicantFoldersResultDto> {
    this.assertMayWithdraw(ctx, options);
    const applicants = await ApplicantModel.find({ _id: { $in: applicantIds }, isDeleted: false })
      .lean<ApplicantDoc[]>()
      .exec();
    const blocks = await this.blocksFor(applicants);
    const deleted: DeletedApplicantFolderDto[] = [];
    const refused: RefusedApplicantFolderDto[] = [];
    for (const applicant of applicants) {
      const reason = blocks.get(String(applicant._id));
      if (reason !== undefined) {
        refused.push({
          applicantId: String(applicant._id),
          applicantCode: applicant.code,
          applicantName: applicant.fullNameAr,
          reason,
        });
        continue;
      }
      deleted.push(await this.removeFiles(ctx, applicant, options));
    }
    return { deleted, refused };
  }
}

export const applicantFolderService = new ApplicantFolderService();
