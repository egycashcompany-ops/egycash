export {
  LoginSchema,
  TotpChallengeSchema,
  TotpVerifySchema,
  ChangePasswordSchema,
  ActivateAccountSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const SessionIdParamSchema = z.object({ id: objectId() }).strict();

export const EnrollChallengeBodySchema = z.object({ challengeToken: z.string().min(1) }).strict();
