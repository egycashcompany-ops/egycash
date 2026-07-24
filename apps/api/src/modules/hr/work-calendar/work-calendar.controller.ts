// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateHoliday,
  type UpdateHoliday,
  type WorkCalendarQuery,
} from '@ecms/contracts';
import { created, ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toHolidayDto, workCalendarService } from './work-calendar.service';

type IdParam = { id: string };

export const getWorkCalendar = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, WorkCalendarQuery, never>(req);
  ok(res, await workCalendarService.calendar(query.from, query.to));
};

export const listHolidays = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, WorkCalendarQuery, never>(req);
  const rows = await workCalendarService.listHolidays(query.from, query.to);
  ok(res, rows.map(toHolidayDto));
};

export const createHoliday = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateHoliday, never, never>(req);
  const doc = await workCalendarService.createHoliday(ctx, body);
  created(res, toHolidayDto(doc), `/api/v1/hr/holidays/${String(doc._id)}`);
};

export const updateHoliday = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateHoliday, never, IdParam>(req);
  const doc = await workCalendarService.updateHoliday(ctx, params.id, body);
  ok(res, toHolidayDto(doc));
};

export const deleteHoliday = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await workCalendarService.deleteHoliday(ctx, params.id);
  ok(res, { deleted: true });
};
