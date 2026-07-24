import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export {
  CancelLeaveRequestSchema,
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendarQuerySchema,
  LeaveEligibilityQuerySchema,
  ListLeaveRequestsQuerySchema,
  ReturnLeaveRequestSchema,
} from '@ecms/contracts';

export const LeaveRequestIdParamSchema = z.object({ id: objectId() }).strict();
