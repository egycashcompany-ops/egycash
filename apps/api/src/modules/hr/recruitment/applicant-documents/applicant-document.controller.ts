// Controllers: unwrap, call, answer. The interesting line in this file is `portalApplicantId` —
// see below, it is the whole of D-APP-9.
import { type Request, type Response } from 'express';
import {
  type ListApplicantDocumentSetsQuery,
  type ListApplicantDocumentTypesQuery,
  type ReviewApplicantDocument,
  type UpdateApplicantDocumentType,
  type UploadApplicantDocument,
  type PageMeta,
} from '@ecms/contracts';
import { ok, created, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import { applicantDocumentService } from './applicant-document.service';
import {
  applicantDocumentTypeService,
  toApplicantDocumentTypeDto,
} from './applicant-document-type.service';
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
