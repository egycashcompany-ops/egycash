// Routers: authenticate → authorize → validate → controller. Calendar READS are open to any
// authenticated user (C2 — calendar facts power every date picker, including self-service);
// holiday administration requires `workCalendar.manage`.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  createHoliday,
  deleteHoliday,
  getWorkCalendar,
  listHolidays,
  updateHoliday,
} from './work-calendar.controller';
import {
  CreateHolidaySchema,
  HolidayIdParamSchema,
  UpdateHolidaySchema,
  WorkCalendarQuerySchema,
} from './work-calendar.validation';

export const buildWorkCalendarRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    validate({ query: WorkCalendarQuerySchema }),
    asyncHandler(getWorkCalendar),
  );
  return router;
};

export const buildHolidaysRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    validate({ query: WorkCalendarQuerySchema }),
    asyncHandler(listHolidays),
  );
  router.post(
    '/',
    authenticate,
    authorize('workCalendar.manage'),
    validate({ body: CreateHolidaySchema }),
    asyncHandler(createHoliday),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('workCalendar.manage'),
    validate({ body: UpdateHolidaySchema, params: HolidayIdParamSchema }),
    asyncHandler(updateHoliday),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('workCalendar.manage'),
    validate({ params: HolidayIdParamSchema }),
    asyncHandler(deleteHoliday),
  );

  return router;
};
