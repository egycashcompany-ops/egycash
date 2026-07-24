// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  CreateEmployeeSchema,
  CreateEmployeeLoginSchema,
  DirectRegisterEmployeeSchema,
  ListEmployeesQuerySchema,
  RehireCheckQuerySchema,
  UpdateEmployeePersonalSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const EmployeeIdParamSchema = z.object({ id: objectId() }).strict();
