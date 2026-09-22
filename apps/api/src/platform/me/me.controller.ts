import { type Request, type Response } from 'express';
import { ok } from '../../infrastructure/http/respond';
import { authContext } from '../auth';
import { meApplicationsService } from './me-applications.service';

// The caller's own effective navigation. No authorize() gate — every authenticated user may read the
// applications they themselves can open, and the resolver answers with exactly those: the ones their
// effective permissions entitle them to, nothing else.
export const getMyApplications = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await meApplicationsService.listEffective(ctx.permissions));
};
