// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type AddEmployeeFileNote,
  type CreateEmployeeFile,
  type ListEmployeeFilesQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeFileService } from './employee-file.service';
import { toEmployeeFileDto } from './employee-file.mapper';

type IdParam = { id: string };

export const createEmployeeFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEmployeeFile>(req);
  const doc = await employeeFileService.create(ctx, body, scopeSelector(ctx, 'employeeFile.create'));
  created(res, toEmployeeFileDto(doc), `/api/v1/hr/employee-files/${String(doc._id)}`);
};

export const listEmployeeFiles = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEmployeeFilesQuery>(req);
  okPage(res, await employeeFileService.list(query, scopeSelector(ctx, 'employeeFile.view')), toEmployeeFileDto);
};

export const getEmployeeFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toEmployeeFileDto(await employeeFileService.getById(params.id, scopeSelector(ctx, 'employeeFile.view'))));
};

export const addEmployeeFileNote = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddEmployeeFileNote, never, IdParam>(req);
  const doc = await employeeFileService.addNote(ctx, params.id, body, scopeSelector(ctx, 'employeeFile.edit'));
  ok(res, toEmployeeFileDto(doc));
};
