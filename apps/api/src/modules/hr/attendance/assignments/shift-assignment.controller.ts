// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateShiftAssignment,
  type ListShiftAssignmentsQuery,
} from '@ecms/contracts';
import { created, noContent, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { shiftAssignmentService, toShiftAssignmentDto } from './shift-assignment.service';

type IdParam = { id: string };

export const listShiftAssignments = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListShiftAssignmentsQuery, never>(req);
  const page = await shiftAssignmentService.list(query);
  okPage(res, page, toShiftAssignmentDto);
};

export const createShiftAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateShiftAssignment, never, never>(req);
  const doc = await shiftAssignmentService.create(ctx, body);
  created(res, toShiftAssignmentDto(doc), `/api/v1/hr/attendance/assignments/${String(doc._id)}`);
};

export const removeShiftAssignment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await shiftAssignmentService.remove(ctx, params.id);
  noContent(res);
};
