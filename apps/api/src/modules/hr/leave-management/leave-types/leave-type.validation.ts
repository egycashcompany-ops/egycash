import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export { CreateLeaveTypeSchema, UpdateLeaveTypeSchema } from '@ecms/contracts';

export const LeaveTypeIdParamSchema = z.object({ id: objectId() }).strict();
