// Thin HTTP mapping only (ADR-003). Employee-keyed reads resolve the own-scope single-target
// shape through the shared resolver (C1-R).
import { type Request, type Response } from 'express';
import {
  type AdjustLeaveBalance,
  type LeaveBalancesQuery,
  type LeaveLedgerQuery,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { employeeRepository } from '../../employee-management/employees';
import { cairoToday, leaveYearOf } from '../../shared/business-date';
import { resolveEmployeeForRead } from '../leave-requests/leave-request.controller';
import { leaveBalanceService, toLedgerEntryDto } from './leave-balance.service';

type IdParam = { id: string };

export const getEmployeeLeaveBalances = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, LeaveBalancesQuery, IdParam>(req);
  const employee = await resolveEmployeeForRead(ctx, params.id, 'leave.view');
  const year = query.year ?? leaveYearOf(cairoToday());
  ok(res, await leaveBalanceService.balancesFor(String(employee._id), year));
};

export const getEmployeeLeaveLedger = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, LeaveLedgerQuery, IdParam>(req);
  // Route-authorized with leave.viewLedger; scope enforced against the employee.
  await employeeRepository.getById(params.id, scopeSelector(ctx, 'leave.viewLedger'));
  okPage(
    res,
    await leaveBalanceService.ledgerFor(params.id, {
      typeId: query.typeId,
      year: query.year,
      page: query.page,
      pageSize: query.pageSize,
    }),
    toLedgerEntryDto,
  );
};

export const adjustEmployeeLeaveBalance = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AdjustLeaveBalance, never, IdParam>(req);
  await employeeRepository.getById(params.id, scopeSelector(ctx, 'leave.adjustBalances'));
  await leaveBalanceService.adjust(ctx, params.id, body);
  ok(res, await leaveBalanceService.balancesFor(params.id, body.year));
};
