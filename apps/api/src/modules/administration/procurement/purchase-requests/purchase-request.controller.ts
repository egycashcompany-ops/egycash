// Thin HTTP mapping only (ADR-003). Every single-record answer is the record (P2 plan §6.5), with
// this reader's acts, so the screen that wrote it holds the request's new version and what it may
// do next.
import { type Request, type Response } from 'express';
import {
  type AddAdministrationPurchaseRequestAttachment,
  type AdministrationPurchaseRequestAttachmentVersionQuery,
  type AdministrationPurchaseRequestDetailDto,
  type CreateAdministrationPurchaseRequest,
  type ListAdministrationPurchaseRequestsQuery,
  type SubmitAdministrationPurchaseRequest,
  type UpdateAdministrationPurchaseRequest,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import {
  toAdministrationPurchaseRequestDetailDto,
  toAdministrationPurchaseRequestDto,
} from '../../administration.mappers';
import { uploadedFileName } from '../../shared/file-upload';
import { administrationPurchaseRequestAttachments as attachments } from './purchase-request-files';
import { type AdministrationPurchaseRequestDoc } from './purchase-request.model';
import { administrationPurchaseRequestService as service } from './purchase-request.service';

type IdParam = { id: string };
type AttachmentParam = { id: string; attachmentId: string };

/**
 * The record this reader is answered with: its acts, and each file's scan state read now (P2.6) —
 * so it is awaited, and every handler that answers the record answers `await detailOf(…)`.
 */
const detailOf = async (
  ctx: AuthContext,
  doc: AdministrationPurchaseRequestDoc,
): Promise<AdministrationPurchaseRequestDetailDto> =>
  toAdministrationPurchaseRequestDetailDto(
    doc,
    service.actionsFor(doc, ctx),
    await attachments.scanStates(ctx, doc),
  );

export const listAdministrationPurchaseRequests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query } = validated<never, ListAdministrationPurchaseRequestsQuery>(req);
  const page = await service.list(query, authContext(req));
  okPage(res, page, toAdministrationPurchaseRequestDto);
};

export const getAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await detailOf(ctx, await service.get(params.id, ctx)));
};

export const createAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body } = validated<CreateAdministrationPurchaseRequest>(req);
  const ctx = authContext(req);
  created(res, await detailOf(ctx, await service.create(body, ctx)));
};

export const updateAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationPurchaseRequest, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await detailOf(ctx, await service.update(params.id, body, ctx)));
};

export const submitAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<SubmitAdministrationPurchaseRequest, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await detailOf(ctx, await service.submit(params.id, body, ctx)));
};

// ── A request's files (P2.6) ────────────────────────────────────────────────

export const addAdministrationPurchaseRequestAttachment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<AddAdministrationPurchaseRequestAttachment, never, IdParam>(
    req,
  );
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const ctx = authContext(req);
  const doc = await attachments.add(ctx, params.id, body, {
    originalName: uploadedFileName(uploaded.originalname),
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  created(res, await detailOf(ctx, doc));
};

export const removeAdministrationPurchaseRequestAttachment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query, params } = validated<
    never,
    AdministrationPurchaseRequestAttachmentVersionQuery,
    AttachmentParam
  >(req);
  const ctx = authContext(req);
  const doc = await attachments.remove(ctx, params.id, params.attachmentId, query.version);
  ok(res, await detailOf(ctx, doc));
};

/** The bytes inline, never cached by anything between the server and the reader (design §11.5). */
export const getAdministrationPurchaseRequestAttachment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, AttachmentParam>(req);
  const file = await attachments.read(authContext(req), params.id, params.attachmentId);
  res.setHeader('Content-Type', file.mime);
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.buffer);
};
