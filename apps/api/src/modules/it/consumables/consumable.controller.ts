// Thin HTTP mapping only (ADR-003). Every stock write answers with the ITEM as it now stands, so the
// screen never re-fetches to learn what its own action did; the issue answers the memo to print at
// once, and every item on it.
//
// Scopes follow the asset register's and the lines' shape, under the store's own grants: reads
// under `itConsumable.view`; adding an item checks that `itConsumable.create` reaches its branch;
// editing, receiving and scrapping are scoped by `itConsumable.edit`; and the custody-like writes —
// issuing to a person, taking back from one — are gated on `itConsumable.assign` but scoped by the
// READ grant, as a line's hand-over is: whoever may hand things out may reach every store they can
// see. The one asset grant left here is the issue's «installed on» check (`assetScope` below).
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
import {
  hasPermission,
  scopeSelector,
  type AuthContext,
  type ScopeSelector,
} from '../../../shared/types';
import { toItConsumableDto, toItConsumableMemoDto, toItConsumableMovementDto } from '../it.mappers';
import { itConsumableService } from './consumable.service';
import { itConsumableIssueService } from './consumable-issue.service';
import { itConsumableTransferService } from './consumable-transfer.service';
import { type ItConsumableMovementDoc } from './consumable-movement.model';

type IdParam = { id: string };

const viewScope = (req: Request) => scopeSelector(authContext(req), 'itConsumable.view');
const editScope = (req: Request) => scopeSelector(authContext(req), 'itConsumable.edit');

/**
 * Where an issue's «installed on» may point: the assets the caller's OWN `itAsset.view` shows them
 * — or none at all without that grant (null), so a store keeper who cannot read the register
 * cannot probe it through the issue either. Every asset id is then the issue's «not found».
 */
const assetScope = (ctx: AuthContext): ScopeSelector | null =>
  hasPermission(ctx, 'itAsset.view') ? scopeSelector(ctx, 'itAsset.view') : null;

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
 * `itConsumable.assign` and SCOPED by it: the items a caller may send are the ones their custody
 * grant covers, and the store they go to must be one that grant reaches. Answered with the
 * transfer, line by line — both stores' items, and which of them it made.
 */
export const transferItConsumables = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TransferItConsumables>(req);
  const ctx = authContext(req);
  created(
    res,
    await itConsumableTransferService.transfer(
      body,
      ctx,
      scopeSelector(ctx, 'itConsumable.assign'),
    ),
  );
};

/**
 * The branches the caller may transfer stock to: the server's own reach of `itConsumable.assign`,
 * so the dialog offers only branches the transfer would accept.
 */
export const listItConsumableTransferTargets = async (
  req: Request,
  res: Response,
): Promise<void> => {
  ok(res, await itConsumableTransferService.transferTargets(authContext(req)));
};

/** «صرف لموظف» — one action, one memo; answered with the memo to print and the items as they stand. */
export const issueItConsumables = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<IssueItConsumables>(req);
  const ctx = authContext(req);
  const { memo, consumables } = await itConsumableIssueService.issue(
    body,
    ctx,
    viewScope(req),
    assetScope(ctx),
  );
  created(res, {
    memo: toItConsumableMemoDto(memo),
    consumables: consumables.map((doc) => toItConsumableDto(doc)),
  });
};
