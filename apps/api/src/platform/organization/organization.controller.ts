import { type Request, type Response } from 'express';
import { type UpdateOrganization } from '@ecms/contracts';
import { ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { organizationService } from './organization.service';

export const getOrganization = async (_req: Request, res: Response): Promise<void> => {
  ok(res, organizationService.toDto(await organizationService.get()));
};

export const updateOrganization = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<UpdateOrganization>(req);
  ok(res, organizationService.toDto(await organizationService.update(body, ctx.userId)));
};
