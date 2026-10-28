// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AtmMachineCreateResultDto,
  type AtmMachinesSummaryQuery,
  type BulkCreateAtmMachinesResultDto,
  type BulkCreateAtmMachines,
  type BulkDeleteAtmMachines,
  type CreateAtmMachine,
  type UpdateAtmMachine,
  type UpdateAtmMachineArea,
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

export const summarizeMachines = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, AtmMachinesSummaryQuery>(req);
  ok(res, await atmMachineService.summary(query, authContext(req)));
};

export const bulkCreateMachines = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<BulkCreateAtmMachines>(req);
  const result = await atmMachineService.bulkCreate(body, authContext(req));
  const dto: BulkCreateAtmMachinesResultDto = {
    ...result,
    created: result.created.map(toAtmMachineDto),
  };
  ok(res, dto);
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
  const result = await atmMachineService.create(body, authContext(req));
  // 201 either way — a new machine, or an archived one back at work (`reactivated`) — with what the
  // register recorded for it (DEC-36).
  const dto: AtmMachineCreateResultDto = {
    ...toAtmMachineDto(result.machine),
    reactivated: result.reactivated,
    register: result.register,
  };
  created(res, dto);
};

export const updateMachine = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmMachine, never, { id: string }>(req);
  ok(res, toAtmMachineDto(await atmMachineService.update(params.id, body, authContext(req))));
};

export const moveMachineArea = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateAtmMachineArea, never, { id: string }>(req);
  ok(res, toAtmMachineDto(await atmMachineService.moveArea(params.id, body, authContext(req))));
};
