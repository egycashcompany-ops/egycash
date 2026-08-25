// Zod schemas re-exported from packages/contracts (shared with the frontend), plus the route-local
// param schema. The module validates every boundary (ADR-007).
export {
  CloseJobRequisitionSchema,
  CreateJobRequisitionSchema,
  DecideJobRequisitionSchema,
  ListJobRequisitionsQuerySchema,
  SubmitJobRequisitionSchema,
  UpdateJobRequisitionSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const RequisitionIdParamSchema = z.object({ id: objectId() }).strict();
