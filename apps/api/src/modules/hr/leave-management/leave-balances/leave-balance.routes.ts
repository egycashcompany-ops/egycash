// Employee-keyed balance surface, mounted under `/hr/employees` (mergeParams — the same
// mounting pattern the Personnel Actions router uses).
import { Router } from 'express';
import { z } from 'zod';
import { objectId, AdjustLeaveBalanceSchema, LeaveBalancesQuerySchema, LeaveLedgerQuerySchema, LeaveEligibilityQuerySchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { leaveEligibility } from '../leave-requests/leave-request.controller';
import {
  adjustEmployeeLeaveBalance,
  getEmployeeLeaveBalances,
  getEmployeeLeaveLedger,
} from './leave-balance.controller';

const EmployeeIdParamSchema = z.object({ id: objectId() }).strict();

/** Mounted under `/hr/employees` — paths are relative to `/:id/leave-*`. */
export const buildLeaveBalancesRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/:id/leave-balances',
    authenticate,
    authorize('leave.view'),
    validate({ query: LeaveBalancesQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeLeaveBalances),
  );
  router.get(
    '/:id/leave-ledger',
    authenticate,
    authorize('leave.viewLedger'),
    validate({ query: LeaveLedgerQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeLeaveLedger),
  );
  router.post(
    '/:id/leave-balances/adjust',
    authenticate,
    authorize('leave.adjustBalances'),
    validate({ body: AdjustLeaveBalanceSchema, params: EmployeeIdParamSchema }),
    asyncHandler(adjustEmployeeLeaveBalance),
  );
  router.get(
    '/:id/leave-eligibility',
    authenticate,
    authorize('leave.view'),
    validate({ query: LeaveEligibilityQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(leaveEligibility),
  );

  return router;
};
