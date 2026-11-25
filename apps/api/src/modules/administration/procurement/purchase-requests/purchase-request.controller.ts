// Thin HTTP mapping only (ADR-003). Every single-record answer is the record (P2 plan §6.5), with
// this reader's acts, so the screen that wrote it holds the request's new version and what it may
// do next.
import { type Request, type Response } from 'express';
import {
  type AdministrationPurchaseRequestDetailDto,
  type CreateAdministrationPurchaseRequest,
  type ListAdministrationPurchaseRequestsQuery,
  type SubmitAdministrationPurchaseRequest,
  type UpdateAdministrationPurchaseRequest,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { type AuthContext } from '../../../../shared/types';
import {
  toAdministrationPurchaseRequestDetailDto,
  toAdministrationPurchaseRequestDto,
} from '../../administration.mappers';
import { type AdministrationPurchaseRequestDoc } from './purchase-request.model';
import { administrationPurchaseRequestService as service } from './purchase-request.service';

type IdParam = { id: string };

const detail = (
  ctx: AuthContext,
  doc: AdministrationPurchaseRequestDoc,
): AdministrationPurchaseRequestDetailDto =>
  toAdministrationPurchaseRequestDetailDto(doc, service.actionsFor(doc, ctx));

export const listAdministrationPurchaseRequests = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { query } = validated<never, ListAdministrationPurchaseRequestsQuery>(req);
  const page = await service.list(query, authContext(req));
  okPage(res, page, toAdministrationPurchaseRequestDto);
};

export const getAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, detail(ctx, await service.get(params.id, ctx)));
};

export const createAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body } = validated<CreateAdministrationPurchaseRequest>(req);
  const ctx = authContext(req);
  created(res, detail(ctx, await service.create(body, ctx)));
};

export const updateAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<UpdateAdministrationPurchaseRequest, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, detail(ctx, await service.update(params.id, body, ctx)));
};

export const submitAdministrationPurchaseRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { body, params } = validated<SubmitAdministrationPurchaseRequest, never, IdParam>(req);
  const ctx = authContext(req);
  ok(res, detail(ctx, await service.submit(params.id, body, ctx)));
};
