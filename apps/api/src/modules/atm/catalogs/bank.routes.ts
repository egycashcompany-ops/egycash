// /atm/banks — the bank catalog (DEC-35).
//
// Reading is open to ANY ATM key: every ATM screen names and colours banks (boards, the register,
// the report, the map, settlements), so whoever reaches any ATM page needs the list — and an
// account outside ATM (an HR-only one, say) learns nothing about banks added at runtime. The list
// of keys is passed in by `atm.module.ts` from `atmPermissions` itself: derived, so it cannot drift
// from the manifest, and passed rather than imported, so this file does not import the manifest
// that imports it.
//
// Writing is `atmBank.create` / `atmBank.edit`, and the service also requires ORGANIZATION scope.
// There is no DELETE: a code keys stored data everywhere, so a bank is archived, never removed.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AtmBankCodeSchema,
  CreateAtmBankSchema,
  UpdateAtmBankSchema,
  type CreateAtmBank,
  type UpdateAtmBank,
} from '@ecms/contracts';
import { authenticate, authContext } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, created, ok, validate, validated } from '../../../platform/web';
import { toAtmBankDto } from '../atm.mappers';
import { atmBankService } from './bank.service';

const CodeParamSchema = z.object({ code: AtmBankCodeSchema }).strict();

const listBanks = async (_req: Request, res: Response): Promise<void> => {
  ok(res, (await atmBankService.list()).map(toAtmBankDto));
};

const createBank = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAtmBank>(req);
  created(res, toAtmBankDto(await atmBankService.create(body, authContext(req))));
};

const updateBank = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmBank, never, { code: string }>(req);
  ok(res, toAtmBankDto(await atmBankService.update(params.code, body, authContext(req))));
};

export const buildAtmBanksRouter = (readKeys: readonly string[]): Router => {
  const [first, ...rest] = readKeys;
  if (first === undefined) throw new Error('buildAtmBanksRouter: no ATM read keys given');
  const router = Router();
  router.get('/', authenticate, authorizeAny(first, ...rest), asyncHandler(listBanks));
  router.post(
    '/',
    authenticate,
    authorize('atmBank.create'),
    validate({ body: CreateAtmBankSchema }),
    asyncHandler(createBank),
  );
  router.patch(
    '/:code',
    authenticate,
    authorize('atmBank.edit'),
    validate({ body: UpdateAtmBankSchema, params: CodeParamSchema }),
    asyncHandler(updateBank),
  );
  return router;
};
