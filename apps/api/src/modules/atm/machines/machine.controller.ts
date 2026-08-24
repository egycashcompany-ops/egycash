// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type CreateAtmMachine,
  type UpdateAtmMachine,
  type ListAtmMachinesQuery,
  type ReassignAtmMachineArea,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAtmMachineDto } from '../atm.mappers';
import { atmMachineService } from './machine.service';

export const listMachines = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListAtmMachinesQuery>(req);
  okPage(res, await atmMachineService.list(query, authContext(req)), toAtmMachineDto);
};

export const bulkCreateMachines = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<BulkCreateAtmMachines>(req);
  const result = await atmMachineService.bulkCreate(body, authContext(req));
  ok(res, {
    created: result.created.map(toAtmMachineDto),
    skippedCodes: result.skippedCodes,
  });
};

export const bulkDeleteMachines = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<BulkDeleteAtmMachines>(req);
  ok(res, await atmMachineService.bulkDelete(body, authContext(req)));
};

export const reassignMachineArea = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ReassignAtmMachineArea>(req);
  ok(res, toAtmMachineDto(await atmMachineService.reassignArea(body, authContext(req))));
};

export const createMachine = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateAtmMachine>(req);
  created(res, toAtmMachineDto(await atmMachineService.create(body, authContext(req))));
};

export const updateMachine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmMachine, never, { id: string }>(req);
  ok(res, toAtmMachineDto(await atmMachineService.update(params.id, body, authContext(req))));
};
