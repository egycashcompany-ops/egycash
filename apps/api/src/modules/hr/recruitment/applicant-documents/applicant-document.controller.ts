// Controllers: unwrap, call, answer. The interesting line in this file is `portalApplicantId` —
// see below, it is the whole of D-APP-9.
import { type Request, type Response } from 'express';
import {
  type BulkDeleteApplicantFolders,
  type DeleteApplicantFolder,
  type ListApplicantDocumentSetsQuery,
  type ListApplicantFoldersQuery,
  type ListApplicantDocumentTypesQuery,
  type ReviewApplicantDocument,
  type UpdateApplicantDocumentType,
  type UploadApplicantDocument,
  type PageMeta,
} from '@ecms/contracts';
import { ok, created, validated } from '../../../../platform/web';
import { applicantFolderService } from './applicant-folder.service';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { NotFoundError, ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import { applicantDocumentService } from './applicant-document.service';
import {
  applicantDocumentTypeService,
  toApplicantDocumentTypeDto,
} from './applicant-document-type.service';
import { applicantPortalService } from '../applicant-portal';
import { portalApplicantId } from './portal-subject';

/** The envelope's page block, computed once rather than spelled out at each call site. */
const pageMeta = (page: number, pageSize: number, totalItems: number): PageMeta => ({
  page,
  pageSize,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
});

/** Multipart intake — the same shape hiring documents use, refused the same way when absent. */
const binaryOf = (req: Request): UploadedBinary => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file === undefined) {
    throw new ValidationError([{ field: 'file', code: 'REQUIRED', message: 'a file is required' }]);
  }
  return {
    originalName: file.originalname,
    mime: file.mimetype,
    size: file.size,
    buffer: file.buffer,
  };
};

// ── The candidate's own routes ──────────────────────────────────────────────

export const getMyDocuments = async (req: Request, res: Response): Promise<void> => {
  ok(res, await applicantDocumentService.setFor(await portalApplicantId(req)));
};

/** Where they stand (D-APP-8). Six words, and the narrowing that produces them is `portal-step.ts`. */
export const getMyStatus = async (req: Request, res: Response): Promise<void> => {
  const status = await applicantPortalService.statusFor(await portalApplicantId(req));
  if (status === null) throw new NotFoundError();
  ok(res, status);
};

export const submitMyDocument = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<UploadApplicantDocument>(req);
  const applicantId = await portalApplicantId(req);
  const set = await applicantDocumentService.submit(
    authContext(req),
    applicantId,
    body,
    binaryOf(req),
  );
  created(res, set);
};

// ── HR's routes ─────────────────────────────────────────────────────────────

export const listApplicantDocumentSets = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<unknown, ListApplicantDocumentSetsQuery>(req);
  const { items, total } = await applicantDocumentService.list({
    page: query.page,
    pageSize: query.pageSize,
    ...(query.pendingOnly === undefined ? {} : { pendingOnly: query.pendingOnly }),
    ...(query.applicantId === undefined ? {} : { applicantId: query.applicantId }),
    ...(query.search === undefined ? {} : { search: query.search }),
  });
  ok(res, items, pageMeta(query.page, query.pageSize, total));
};

/** The Applicant documents page's folders: one per applicant. */
export const listApplicantFolders = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<unknown, ListApplicantFoldersQuery>(req);
  const { items, total } = await applicantFolderService.list(query);
  ok(res, items, pageMeta(query.page, query.pageSize, total));
};

export const getApplicantFolder = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<unknown, unknown, { applicantId: string }>(req);
  ok(res, await applicantFolderService.get(params.applicantId));
};

/**
 * Empty one applicant's folder. The files go; the applicant stays.
 *
 * A kept record (hired, already an employee, or holding an accepted offer) is refused with
 * `APPLICANT_FOLDER_KEPT_RECORD` — the service decides, so hiding the button is a courtesy and
 * never the gate.
 */
/**
 * The withdrawal instruction, or null when none was asked for.
 *
 * The scope is resolved against `applicant.edit` — the key withdrawing actually needs — and not
 * against the `applicantDocument.delete` key that opened this route, so a caller whose applicant
 * reach is narrower than their folder reach stays inside it. The service refuses outright if they
 * do not hold that key at all.
 *
 * `withdrawReason` is guaranteed present by the schema whenever `withdraw` is true; the fallback
 * is here so this reads without the reader having to go and check that.
 */
const withdrawalFrom = (
  ctx: ReturnType<typeof authContext>,
  body: { withdraw: boolean; withdrawReason?: string | undefined },
): { reason: string; scope: ReturnType<typeof scopeSelector> } | null =>
  body.withdraw && body.withdrawReason !== undefined
    ? { reason: body.withdrawReason, scope: scopeSelector(ctx, 'applicant.edit') }
    : null;

export const deleteApplicantFolder = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DeleteApplicantFolder, unknown, { applicantId: string }>(req);
  ok(
    res,
    await applicantFolderService.deleteFolder(ctx, params.applicantId, {
      withdraw: withdrawalFrom(ctx, body),
    }),
  );
};

/** Empty several folders at once, reporting what was emptied and what was refused. */
export const bulkDeleteApplicantFolders = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkDeleteApplicantFolders>(req);
  ok(
    res,
    await applicantFolderService.deleteFolders(ctx, body.applicantIds, {
      withdraw: withdrawalFrom(ctx, body),
    }),
  );
};

export const getApplicantDocuments = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<unknown, unknown, { applicantId: string }>(req);
  ok(res, await applicantDocumentService.setFor(params.applicantId));
};

export const reviewApplicantDocument = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<
    ReviewApplicantDocument,
    unknown,
    { applicantId: string; typeId: string }
  >(req);
  ok(
    res,
    await applicantDocumentService.review(
      authContext(req),
      params.applicantId,
      params.typeId,
      body,
    ),
  );
};

// ── The catalogue ───────────────────────────────────────────────────────────

export const listApplicantDocumentTypes = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<unknown, ListApplicantDocumentTypesQuery>(req);
  const { items, total } = await applicantDocumentTypeService.list({
    page: query.page,
    pageSize: query.pageSize,
    ...(query.active === undefined ? {} : { active: query.active }),
  });
  ok(res, items.map(toApplicantDocumentTypeDto), pageMeta(query.page, query.pageSize, total));
};

export const updateApplicantDocumentType = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateApplicantDocumentType, unknown, { id: string }>(req);
  ok(res, toApplicantDocumentTypeDto(await applicantDocumentTypeService.update(params.id, body)));
};
