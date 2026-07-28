// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type AddEmployeeFileNote,
  type CreateEmployeeFile,
  type ListEmployeeFilesQuery,
  type RemoveEmployeeFileDocument,
  type UploadEmployeeFileDocument,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { ValidationError } from '../../../../shared/errors';
import { scopeSelector, type AuthContext } from '../../../../shared/types';
import { type UploadedBinary } from '../../../../platform/files';
import { employeeFileService } from './employee-file.service';
import { toEmployeeFileDto } from './employee-file.mapper';
import { type EmployeeFileDoc } from './employee-file.model';

type IdParam = { id: string };
type DocumentParam = { id: string; documentId: string };

/**
 * I5 — a single-file response carries the canonical recruitment history, read from
 * `hr_recruitment_timeline`. List rows deliberately do not: a row shows no history, so paying for
 * one read per row would buy nothing.
 */
const fileDto = async (doc: EmployeeFileDoc, ctx: AuthContext) =>
  toEmployeeFileDto(doc, await employeeFileService.recruitmentTimelineOf(doc, ctx));

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  return { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer };
};

export const createEmployeeFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEmployeeFile>(req);
  const scope = scopeSelector(ctx, 'employeeFile.create');
  const doc = await employeeFileService.create(ctx, body, scope);
  created(res, await fileDto(doc, ctx), `/api/v1/hr/employee-files/${String(doc._id)}`);
};

export const listEmployeeFiles = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeeFilesQuery>(req);
  okPage(res, await employeeFileService.list(query, scopeSelector(ctx, 'employeeFile.view')), toEmployeeFileDto);
};

export const getEmployeeFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'employeeFile.view');
  ok(res, await fileDto(await employeeFileService.getById(params.id, scope), ctx));
};

export const addEmployeeFileNote = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddEmployeeFileNote, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'employeeFile.edit');
  ok(res, await fileDto(await employeeFileService.addNote(ctx, params.id, body, scope), ctx));
};

export const uploadEmployeeFileDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UploadEmployeeFileDocument, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'employeeFile.upload');
  const doc = await employeeFileService.uploadDocument(ctx, params.id, body, binaryOf(req), scope);
  ok(res, await fileDto(doc, ctx));
};

export const removeEmployeeFileDocument = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RemoveEmployeeFileDocument, never, DocumentParam>(req);
  const scope = scopeSelector(ctx, 'employeeFile.upload');
  const doc = await employeeFileService.removeDocument(ctx, params.id, params.documentId, body, scope);
  ok(res, await fileDto(doc, ctx));
};
