// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type BulkApplicants,
  type ConfirmApplicantIdentity,
  type CreateApplicantSource,
  type ExportApplicantsQuery,
  type ListApplicantSourcesQuery,
  type ListApplicantsQuery,
  type OcrExtractNationalId,
  type RegisterApplicant,
  type RestoreApplicant,
  type UpdateApplicant,
  type UpdateApplicantSource,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import { applicantService } from './applicant.service';
import { applicantSourceService } from './applicant-source.service';
import { toApplicantDto, toApplicantSourceDto } from './applicant.mapper';
import { extractNationalIdFields } from './national-id-ocr';

type IdParam = { id: string };

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  return { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer };
};

// ── Applicants ───────────────────────────────────────────────────────────────

export const registerApplicant = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<RegisterApplicant>(req);
  const doc = await applicantService.register(ctx, body);
  created(res, toApplicantDto(doc), `/api/v1/hr/applicants/${String(doc._id)}`);
};

export const listApplicants = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListApplicantsQuery>(req);
  const page = await applicantService.list(query, scopeSelector(ctx, 'applicant.view'));
  okPage(res, page, toApplicantDto);
};

export const getApplicant = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toApplicantDto(await applicantService.getById(params.id, scopeSelector(ctx, 'applicant.view'))));
};

export const updateApplicant = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateApplicant, never, IdParam>(req);
  const doc = await applicantService.update(ctx, params.id, body, scopeSelector(ctx, 'applicant.edit'));
  ok(res, toApplicantDto(doc));
};

export const confirmApplicantIdentity = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ConfirmApplicantIdentity, never, IdParam>(req);
  const doc = await applicantService.confirmIdentity(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'applicant.verifyIdentity'),
  );
  ok(res, toApplicantDto(doc));
};

export const withdrawApplicant = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<WithdrawApplicant, never, IdParam>(req);
  const doc = await applicantService.withdraw(ctx, params.id, body, scopeSelector(ctx, 'applicant.edit'));
  ok(res, toApplicantDto(doc));
};

export const restoreApplicant = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RestoreApplicant, never, IdParam>(req);
  const doc = await applicantService.restore(ctx, params.id, body, scopeSelector(ctx, 'applicant.edit'));
  ok(res, toApplicantDto(doc));
};

export const bulkApplicants = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkApplicants>(req);
  ok(res, await applicantService.bulk(ctx, body, scopeSelector(ctx, 'applicant.edit')));
};

export const exportApplicants = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ExportApplicantsQuery>(req);
  // Export is masked by default; unmasked egress is deferred (OQ-27), so `unmask` is false.
  const { csv } = await applicantService.export(ctx, query, scopeSelector(ctx, 'applicant.export'), false);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="applicants.csv"');
  res.status(200).send(csv);
};

export const ocrExtractNationalId = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<OcrExtractNationalId>(req);
  ok(res, await extractNationalIdFields({ frontFileId: body.frontFileId, backFileId: body.backFileId }));
};

// ── Attachments ────────────────────────────────────────────────────────────

export const addApplicantAttachment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<
    { title: string; categoryId: string; notes?: string },
    never,
    IdParam
  >(req);
  const result = await applicantService.addAttachment(
    ctx,
    params.id,
    binaryOf(req),
    { title: body.title, categoryId: body.categoryId, notes: body.notes },
    scopeSelector(ctx, 'applicant.edit'),
  );
  created(res, result);
};

export const listApplicantAttachments = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await applicantService.listAttachments(params.id, scopeSelector(ctx, 'applicant.view')));
};

export const removeApplicantAttachment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, { id: string; fileId: string }>(req);
  await applicantService.removeAttachment(ctx, params.id, params.fileId, scopeSelector(ctx, 'applicant.edit'));
  noContent(res);
};

// ── Sources (admin catalog) ──────────────────────────────────────────────────

export const createApplicantSource = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateApplicantSource>(req);
  const doc = await applicantSourceService.create(body, ctx.userId);
  created(res, toApplicantSourceDto(doc), `/api/v1/hr/applicant-sources/${String(doc._id)}`);
};

export const listApplicantSources = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListApplicantSourcesQuery>(req);
  okPage(res, await applicantSourceService.list(query), toApplicantSourceDto);
};

export const updateApplicantSource = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateApplicantSource, never, IdParam>(req);
  const doc = await applicantSourceService.update(params.id, body, ctx.userId);
  ok(res, toApplicantSourceDto(doc));
};
