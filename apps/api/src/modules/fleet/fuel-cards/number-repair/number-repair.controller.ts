// Thin HTTP mapping only (ADR-003) — «تصحيح أرقام الكروت» (6d).
import { type Request, type Response } from 'express';
import { type ExecuteFleetFuelNumberRepair } from '@ecms/contracts';
import { ok, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { fleetFuelNumberRepairService } from './number-repair.service';

/** The live dry run — masked numbers, no PIN; writes nothing. */
export const getFuelNumberRepair = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetFuelNumberRepairService.dryRun());
};

/** «تنفيذ التصحيح» — the reviewed ready units, each in its own transaction. */
export const executeFuelNumberRepair = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ExecuteFleetFuelNumberRepair>(req);
  ok(res, await fleetFuelNumberRepairService.execute(authContext(req), body));
};
