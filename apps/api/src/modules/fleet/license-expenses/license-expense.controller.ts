// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetLicenseExpense,
  type ListFleetLicenseExpensesQuery,
  type SaveFleetLicenseExpenseSettings,
  type UpdateFleetLicenseExpense,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { fleetLicenseExpenseService } from './license-expense.service';

type IdParam = { id: string };

export const listLicenseExpenses = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetLicenseExpensesQuery>(req);
  okPage(res, await fleetLicenseExpenseService.list(query), (dto) => dto);
};

export const getLicenseExpense = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await fleetLicenseExpenseService.get(params.id));
};

export const createLicenseExpense = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetLicenseExpense>(req);
  created(res, await fleetLicenseExpenseService.create(body, authContext(req).userId));
};

export const updateLicenseExpense = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetLicenseExpense, never, IdParam>(req);
  ok(res, await fleetLicenseExpenseService.update(params.id, body, authContext(req).userId));
};

export const deleteLicenseExpense = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetLicenseExpenseService.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const getLicenseExpenseSettings = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetLicenseExpenseService.getSettings());
};

export const saveLicenseExpenseSettings = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveFleetLicenseExpenseSettings>(req);
  ok(res, await fleetLicenseExpenseService.saveSettings(body, authContext(req).userId));
};
