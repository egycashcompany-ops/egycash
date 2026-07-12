// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly. `missingRequired` is derived
// against the live document-type catalog and passed into the mapper.
import { type Request, type Response } from 'express';
import {
  type CompleteHiringDocuments,
  type CreateHiringDocumentType,
  type CreateHiringDocuments,
  type ListHiringDocumentTypesQuery,
  type ListHiringDocumentsQuery,
  type ReplaceHiringDocument,
  type UpdateHiringDocumentType,
  type UploadHiringDocument,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import { hiringDocumentsService } from './hiring-documents.service';
import { hiringDocumentTypeService } from './hiring-document-type.service';
import {
  computeMissingRequired,
  toHiringDocumentTypeDto,
  toHiringDocumentsDto,
} from './hiring-documents.mapper';
import { type HiringDocumentsDoc } from './hiring-documents.model';

type IdParam = { id: string };
type TypeParam = { id: string; typeId: string };

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  return { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer };
};

const respond = async (res: Response, doc: HiringDocumentsDoc, status = 200): Promise<void> => {
  const keys = await hiringDocumentsService.activeRequiredKeys();
  const dto = toHiringDocumentsDto(doc, computeMissingRequired(doc, keys));
  if (status === 201) created(res, dto, `/api/v1/hr/hiring-documents/${dto.id}`);
  else ok(res, dto);
};

// ── Hiring documents ─────────────────────────────────────────────────────────

export const createHiringDocuments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateHiringDocuments>(req);
  const doc = await hiringDocumentsService.create(ctx, body, scopeSelector(ctx, 'hiringDocuments.create'));
  await respond(res, doc, 201);
};

export const listHiringDocuments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListHiringDocumentsQuery>(req);
  const page = await hiringDocumentsService.list(query, scopeSelector(ctx, 'hiringDocuments.view'));
  const keys = await hiringDocumentsService.activeRequiredKeys();
  okPage(res, page, (d) => toHiringDocumentsDto(d, computeMissingRequired(d, keys)));
};

export const getHiringDocuments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await hiringDocumentsService.getById(params.id, scopeSelector(ctx, 'hiringDocuments.view'));
  await respond(res, doc);
};

export const uploadHiringDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UploadHiringDocument, never, IdParam>(req);
  const doc = await hiringDocumentsService.uploadDocument(
    ctx,
    params.id,
    body,
    binaryOf(req),
    scopeSelector(ctx, 'hiringDocuments.upload'),
  );
  await respond(res, doc);
};

export const replaceHiringDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReplaceHiringDocument, never, TypeParam>(req);
  const doc = await hiringDocumentsService.replaceDocument(
    ctx,
    params.id,
    params.typeId,
    body,
    binaryOf(req),
    scopeSelector(ctx, 'hiringDocuments.upload'),
  );
  await respond(res, doc);
};

export const listHiringDocumentVersions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, TypeParam>(req);
  ok(res, await hiringDocumentsService.listDocumentVersions(params.id, params.typeId, scopeSelector(ctx, 'hiringDocuments.view')));
};

export const completeHiringDocuments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CompleteHiringDocuments, never, IdParam>(req);
  const doc = await hiringDocumentsService.complete(ctx, params.id, body, scopeSelector(ctx, 'hiringDocuments.complete'));
  await respond(res, doc);
};

// ── Document types (admin catalog) ───────────────────────────────────────────

export const createHiringDocumentType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateHiringDocumentType>(req);
  const doc = await hiringDocumentTypeService.create(body, ctx.userId);
  created(res, toHiringDocumentTypeDto(doc), `/api/v1/hr/hiring-document-types/${String(doc._id)}`);
};

export const listHiringDocumentTypes = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListHiringDocumentTypesQuery>(req);
  okPage(res, await hiringDocumentTypeService.list(query), toHiringDocumentTypeDto);
};

export const updateHiringDocumentType = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateHiringDocumentType, never, IdParam>(req);
  const doc = await hiringDocumentTypeService.update(params.id, body, ctx.userId);
  ok(res, toHiringDocumentTypeDto(doc));
};
