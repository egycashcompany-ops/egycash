// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type CompensationQuery } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { compensationService } from './compensation.service';

type EmployeeParam = { employeeId: string };

export const getEmployeeCompensation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query, params } = validated<never, CompensationQuery, EmployeeParam>(req);
  ok(
    res,
    await compensationService.effectsFor(
      params.employeeId,
      query.period,
      scopeSelector(ctx, 'employee.viewCompensation'),
    ),
  );
};
