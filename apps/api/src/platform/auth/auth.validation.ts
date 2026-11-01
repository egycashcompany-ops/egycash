export {
  LoginSchema,
  TotpChallengeSchema,
  TotpVerifySchema,
  ChangePasswordSchema,
  ActivateAccountSchema,
  UpdateMyPreferencesSchema,
  StartPortalChallengeSchema,
  CompletePortalChallengeSchema,
  PasskeyAuthenticationVerifySchema,
  PasskeyRegistrationOptionsSchema,
  PasskeyRegistrationVerifySchema,
  RenamePasskeySchema,
  PasskeyIdParamSchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const SessionIdParamSchema = z.object({ id: objectId() }).strict();

export const EnrollChallengeBodySchema = z.object({ challengeToken: z.string().min(1) }).strict();
