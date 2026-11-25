// Thin HTTP mapping only (ADR-003). Every single-record answer is the detail (§13.6 B) — the row,
// its papers with their scan states and the tax-number warning — so the screen that wrote it holds
// the record's new version and sees the warning as soon as it saves.
import { type Request, type Response } from 'express';
import {
  type AddAdministrationSupplierAttachment,
  type AdministrationSupplierAttachmentVersionQuery,
  type AdministrationSupplierDetailDto,
  type CreateAdministrationSupplier,
  type ListAdministrationSuppliersQuery,
  type UpdateAdministrationSupplier,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import {
  toAdministrationSupplierDetailDto,
  toAdministrationSupplierDto,
} from '../../administration.mappers';
import { uploadedFileName } from '../../shared/file-upload';
import { administrationSupplierPapers as papers } from './supplier-files';
import { type AdministrationSupplierDoc } from './supplier.model';
import { administrationSupplierService as service } from './supplier.service';

type IdParam = { id: string };
type PaperParam = { id: string; attachmentId: string };

const detail = async (
  ctx: AuthContext,
  doc: AdministrationSupplierDoc,
): Promise<AdministrationSupplierDetailDto> =>
  toAdministrationSupplierDetailDto(doc, await service.detailFacts(ctx, doc));

export const listAdministrationSuppliers = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAdministrationSuppliersQuery>(req);
  const page = await service.list(query);
  const labels = await service.labels(page.items);
  okPage(res, page, (doc) => toAdministrationSupplierDto(doc, labels));
};

export const getAdministrationSupplier = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await detail(ctx, await service.getById(params.id)));
};

export const createAdministrationSupplier = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAdministrationSupplier>(req);
  const ctx = authContext(req);
  created(res, await detail(ctx, await service.create(body, ctx)));
};

export const updateAdministrationSupplier = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationSupplier, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, await detail(ctx, await service.update(params.id, body, ctx)));
};

export const addAdministrationSupplierPaper = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<AddAdministrationSupplierAttachment, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const ctx = authContext(req);
  const doc = await papers.add(ctx, params.id, body, {
    originalName: uploadedFileName(uploaded.originalname),
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  created(res, await detail(ctx, doc));
};

export const removeAdministrationSupplierPaper = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query, params } = validated<
    never,
    AdministrationSupplierAttachmentVersionQuery,
    PaperParam
  >(req);
  const ctx = authContext(req);
  const doc = await papers.remove(ctx, params.id, params.attachmentId, query.version);
  ok(res, await detail(ctx, doc));
};

/** The bytes inline, never cached by anything between the server and the reader (§11.5). */
export const getAdministrationSupplierPaper = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, PaperParam>(req);
  const paper = await papers.read(authContext(req), params.id, params.attachmentId);
  res.setHeader('Content-Type', paper.mime);
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(paper.fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(paper.buffer);
};
