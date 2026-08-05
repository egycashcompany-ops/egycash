// The directory's HTTP surface. `authenticate` only, no `authorize`: this is an identity card, not
// user administration, and someone who can see that an action happened must be able to see who did
// it. The DTO the service returns is closed, so "no permission" does not mean "no boundary".
import { Router, type Request, type Response } from 'express';
import {
  DirectoryProfileIdParamSchema,
  ResolveDirectoryProfilesSchema,
  type ResolveDirectoryProfiles,
} from '@ecms/contracts';
import { asyncHandler, ok, validate, validated } from '../web';
import { authenticate } from '../auth';
import { NotFoundError } from '../../shared/errors';
import { directoryProfileService } from './directory-profile.service';

const getProfile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { userId: string }>(req);
  const profile = await directoryProfileService.get(params.userId);
  if (profile === null) throw new NotFoundError('Directory profile');
  ok(res, profile);
};

const resolveProfiles = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ResolveDirectoryProfiles>(req);
  // Everyone in one call — the client never loops.
  const found = await directoryProfileService.resolve(body.userIds);
  ok(res, [...found.values()]);
};

export const buildDirectoryRouter = (): Router => {
  const router = Router();
  router.post(
    '/resolve',
    authenticate,
    validate({ body: ResolveDirectoryProfilesSchema }),
    asyncHandler(resolveProfiles),
  );
  router.get(
    '/:userId',
    authenticate,
    validate({ params: DirectoryProfileIdParamSchema }),
    asyncHandler(getProfile),
  );
  return router;
};
