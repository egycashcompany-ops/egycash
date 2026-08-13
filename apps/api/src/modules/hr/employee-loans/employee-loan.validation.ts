// Zod schemas re-exported from packages/contracts (shared with the frontend), plus route-local
// param schemas. The module validates every boundary (ADR-007).
export {
  AccelerateEmployeeLoanSchema,
  CancelEmployeeLoanSchema,
  CreateEmployeeLoanSchema,
  DecideEmployeeLoanSchema,
  DisburseEmployeeLoanSchema,
  ListEmployeeLoansQuerySchema,
  RescheduleEmployeeLoanSchema,
  SettleEmployeeLoanExternallySchema,
  SubmitEmployeeLoanSchema,
  UpdateEmployeeLoanSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const LoanIdParamSchema = z.object({ id: objectId(), loanId: objectId() }).strict();
