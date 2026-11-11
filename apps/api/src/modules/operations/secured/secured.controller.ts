// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  ymdOf,
  type AssignSecuredDeliveryLeg,
  type CancelVaultReceipt,
  type ConfirmSecuredPickup,
  type DispatchSecuredShipments,
  type ListSecuredBacklogQuery,
  type ListSecuredDueQuery,
  type ListVaultInventoryQuery,
  type OperationsSecuredBoardDto,
  type OperationsSecuredDispatchBoardDto,
  type OperationsSecuredDispatchBoardQuery,
  type OperationsVaultQueueDto,
  type OperationsVaultQueueQuery,
  type ReceiveIntoVault,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import {
  toShipmentAssignmentDto,
  toShipmentDto,
  toVaultInventoryRowDto,
} from '../operations.mappers';
import { boardForReader, utcDayIso } from '../shipments/board-for-reader';
import { vaultCustody } from '../treasury-boundary';
import { operationsSecuredService } from './secured.service';

type IdParam = { id: string };

export const listBacklog = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListSecuredBacklogQuery>(req);
  okPage(res, await operationsSecuredService.backlog(query), toShipmentDto);
};

/**
 * The secured screen — every open محصنة as a board row, mapped for this reader through the same
 * `boardForReader` as the day board (the crew plan behind `operationsCrew.view`).
 */
export const getSecuredBoard = async (req: Request, res: Response): Promise<void> => {
  const view = await operationsSecuredService.board();
  ok<OperationsSecuredBoardDto>(res, boardForReader(req, view));
};

/** The vault's receive queue — the yellow rows, today's green ones, and with `all` the white ones. */
export const getVaultQueue = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsVaultQueueQuery>(req);
  const all = query.all ?? false;
  const view = await operationsSecuredService.vaultQueue(all);
  const board = boardForReader(req, view);
  ok<OperationsVaultQueueDto>(res, {
    date: utcDayIso(view.day),
    all,
    shipments: board.shipments.map((row) => {
      const receivedAt = view.receivedAt.get(row.id);
      return {
        ...row,
        vaultReceivedAt: receivedAt === undefined ? null : receivedAt.toISOString(),
      };
    }),
    crews: board.crews,
  });
};

/**
 * «صرف الخزينة» (Round 10) — every secured shipment in the vault, optionally on one delivery day,
 * as board rows mapped for this reader, each with when the vault took it in, whether it is overdue
 * and its delivery leg's version.
 */
export const getSecuredDispatchBoard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsSecuredDispatchBoardQuery>(req);
  const view = await operationsSecuredService.dispatchBoard(query.date);
  const board = boardForReader(req, view);
  const today = ymdOf(view.today);
  ok<OperationsSecuredDispatchBoardDto>(res, {
    date: query.date === undefined ? null : utcDayIso(query.date),
    today: utcDayIso(view.today),
    shipments: board.shipments.map((row) => {
      const receivedAt = view.receivedAt.get(row.id);
      return {
        ...row,
        vaultReceivedAt: receivedAt === undefined ? null : receivedAt.toISOString(),
        // Calendar days compared as 'YYYY-MM-DD': the stored delivery date is a UTC day, and
        // "today" is the Cairo one the server resolved.
        overdue: row.deliveryDate !== null && ymdOf(row.deliveryDate) < today,
        deliveryLegVersion: view.deliveryLegVersion.get(row.id) ?? null,
      };
    }),
    crews: board.crews,
  });
};

/** The desk's pickup ✓ — «تم الاستلام من العمليات» (Round 10). */
export const confirmSecuredPickup = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ConfirmSecuredPickup, never, IdParam>(req);
  const doc = await operationsSecuredService.confirmPickup(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

/** …and the undo of a pickup ✓ — the captain's or the desk's — until the vault receives (Round 10). */
export const undoSecuredPickup = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ConfirmSecuredPickup, never, IdParam>(req);
  const doc = await operationsSecuredService.undoPickup(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

/** Cancel the vault's receipt — the special grant (Round 10). */
export const cancelVaultReceipt = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CancelVaultReceipt, never, IdParam>(req);
  const doc = await operationsSecuredService.cancelReceipt(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const listDue = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListSecuredDueQuery>(req);
  const items = await operationsSecuredService.dueForDelivery(query.date);
  ok(res, items.map(toShipmentDto));
};

export const listVaultInventory = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListVaultInventoryQuery>(req);
  const { items, total } = await vaultCustody().listHeld(query.page, query.pageSize);
  // The standard paginated envelope, like every other list in the system — the port answers with
  // a flat count, and the HTTP layer is where that becomes `meta`.
  okPage(
    res,
    {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    },
    toVaultInventoryRowDto,
  );
};

export const receiveIntoVault = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReceiveIntoVault, never, IdParam>(req);
  const doc = await operationsSecuredService.receiveIntoVault(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toShipmentDto(doc));
};

export const assignDeliveryLeg = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AssignSecuredDeliveryLeg, never, IdParam>(req);
  const doc = await operationsSecuredService.assignDeliveryLeg(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toShipmentAssignmentDto(doc));
};

export const dispatchSecured = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<DispatchSecuredShipments>(req);
  ok(res, await operationsSecuredService.dispatch(body, authContext(req).userId));
};
