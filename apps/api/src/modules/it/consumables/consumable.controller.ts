// Thin HTTP mapping only (ADR-003). Every stock write answers with the ITEM as it now stands, so the
// screen never re-fetches to learn what its own action did; the issue answers the memo to print at
// once, and every item on it.
//
// Scopes follow the asset register and the lines exactly: reads under `itAsset.view`; adding an
// item checks that `itAsset.create` reaches its branch; editing, receiving and scrapping are scoped
// by `itAsset.edit`; and the custody-like writes — issuing to a person, taking back from one — are
// gated on `itAsset.assign` but scoped by the READ grant, as a line's hand-over is: whoever may
// hand things out may reach every store they can see.
import { type Request, type Response } from 'express';
import {
  type CreateItConsumable,
  type IssueItConsumables,
  type ListItConsumableMovementsQuery,
  type ListItConsumablesQuery,
  type ReceiveItConsumable,
  type ReturnItConsumable,
  type ScrapItConsumable,
  type TransferItConsumables,
  type UpdateItConsumable,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toItConsumableDto, toItConsumableMemoDto, toItConsumableMovementDto } from '../it.mappers';
import { itConsumableService } from './consumable.service';
import { itConsumableIssueService } from './consumable-issue.service';
import { itConsumableTransferService } from './consumable-transfer.service';
import { type ItConsumableMovementDoc } from './consumable-movement.model';

type IdParam = { id: string };

const viewScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.view');
const editScope = (req: Request) => scopeSelector(authContext(req), 'itAsset.edit');

/** A page of the ledger, labelled in one pass — the items, people, assets and memos it names. */
const movementPage = async (
  req: Request,
  res: Response,
  page: Awaited<ReturnType<typeof itConsumableService.listMovements>>,
): Promise<void> => {
  const labels = await itConsumableService.movementLabels(page.items, viewScope(req));
  okPage(res, page, (doc: ItConsumableMovementDoc) => toItConsumableMovementDto(doc, labels));
};

export const listItConsumables = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItConsumablesQuery>(req);
  const page = await itConsumableService.list(query, viewScope(req));
  okPage(res, page, (doc) => toItConsumableDto(doc));
};

export const getItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItConsumableDto(await itConsumableService.get(params.id, viewScope(req))));
};

export const createItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItConsumable>(req);
  created(res, toItConsumableDto(await itConsumableService.create(body, authContext(req))));
};

export const updateItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItConsumable, never, IdParam>(req);
  const item = await itConsumableService.update(params.id, body, authContext(req), editScope(req));
  ok(res, toItConsumableDto(item));
};

export const receiveItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReceiveItConsumable, never, IdParam>(req);
  const item = await itConsumableService.receive(params.id, body, authContext(req), editScope(req));
  ok(res, toItConsumableDto(item));
};

export const scrapItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ScrapItConsumable, never, IdParam>(req);
  const item = await itConsumableService.scrap(params.id, body, authContext(req), editScope(req));
  ok(res, toItConsumableDto(item));
};

export const returnItConsumable = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReturnItConsumable, never, IdParam>(req);
  const item = await itConsumableService.returnStock(
    params.id,
    body,
    authContext(req),
    viewScope(req),
  );
  ok(res, toItConsumableDto(item));
};

/** One item's movements, newest first — the item's own movements list. */
export const listItConsumableMovementsOf = async (req: Request, res: Response): Promise<void> => {
  const { params, query } = validated<never, ListItConsumableMovementsQuery, IdParam>(req);
  await movementPage(
    req,
    res,
    await itConsumableService.itemMovements(params.id, query, viewScope(req)),
  );
};

/** The ledger across items — the movements page, the asset's card and the employee's card. */
export const listItConsumableMovements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItConsumableMovementsQuery>(req);
  await movementPage(req, res, await itConsumableService.listMovements(query, viewScope(req)));
};

/**
 * «تحويل إلى فرع» — stock of one store's items to another branch's store, at once. Gated on
 * `itAsset.assign` and SCOPED by it: the items a caller may send are the ones their custody grant
 * covers, and the store they go to must be one that grant reaches. Answered with the transfer, line
 * by line — both stores' items, and which of them it made.
 */
export const transferItConsumables = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TransferItConsumables>(req);
  const ctx = authContext(req);
  created(
    res,
    await itConsumableTransferService.transfer(body, ctx, scopeSelector(ctx, 'itAsset.assign')),
  );
};

/** «صرف لموظف» — one action, one memo; answered with the memo to print and the items as they stand. */
export const issueItConsumables = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<IssueItConsumables>(req);
  const { memo, consumables } = await itConsumableIssueService.issue(
    body,
    authContext(req),
    viewScope(req),
  );
  created(res, {
    memo: toItConsumableMemoDto(memo),
    consumables: consumables.map((doc) => toItConsumableDto(doc)),
  });
};
