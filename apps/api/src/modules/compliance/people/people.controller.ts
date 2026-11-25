// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import { type ListCompliancePeopleQuery } from '@ecms/contracts';
import { ok, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { compliancePeopleService } from './people.service';

export const listCompliancePeople = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListCompliancePeopleQuery>(req);
  const page = await compliancePeopleService.picker(query, authContext(req).userId);
  ok(res, page.items, page.meta);
};
