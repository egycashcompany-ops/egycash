// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsCurrency,
  type ListOperationsReferenceQuery,
  type UpdateOperationsCurrency,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toCurrencyDto } from '../operations.mappers';
import { operationsCurrencyService } from './currency.service';

type IdParam = { id: string };

export const listCurrencies = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsReferenceQuery>(req);
  okPage(res, await operationsCurrencyService.list(query), toCurrencyDto);
};

export const createCurrency = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsCurrency>(req);
  const doc = await operationsCurrencyService.create(body, authContext(req).userId);
  created(res, toCurrencyDto(doc));
};

export const updateCurrency = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsCurrency, never, IdParam>(req);
  const doc = await operationsCurrencyService.update(params.id, body, authContext(req).userId);
  ok(res, toCurrencyDto(doc));
};
