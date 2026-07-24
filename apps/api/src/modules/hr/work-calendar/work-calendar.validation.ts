import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export {
  CreateHolidaySchema,
  UpdateHolidaySchema,
  WorkCalendarQuerySchema,
} from '@ecms/contracts';

export const HolidayIdParamSchema = z.object({ id: objectId() }).strict();
