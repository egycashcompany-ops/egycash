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
  type OperationsSecuredDistributionDto,
  type OperationsSecuredDistributionQuery,
  type OperationsSecuredDistributionSaveDto,
  type SaveSecuredDistribution,
  type OperationsSecuredDispatchBoardDto,
  type OperationsSecuredDispatchBoardQuery,
  type OperationsVaultQueueDto,
  type OperationsVaultQueueQuery,
  type ReceiveIntoVault,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { hasPermission } from '../../../shared/types';
import {
  toShipmentAssignmentDto,
  toShipmentDto,
  toVaultInventoryRowDto,
} from '../operations.mappers';
import { boardForReader, utcDayIso } from '../shipments/board-for-reader';
import { vaultCustody } from '../treasury-boundary';
import { operationsSecuredService } from './secured.service';
import { operationsDistributionService } from './distribution.service';

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

/**
 * The vault's receive queue — what it can receive now (every draft collected by today, white or
 * yellow, and the yellow ones of any day) and today's green ones; with `all`, the white ones booked
 * for a later day too (Round 13).
 */
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

/**
 * «توزيع المحصنات» / «تسليم المحصنات» (Round 12) — the day's vans and its محصنات, for this reader.
 *
 * The shipments go through `boardForReader` like every board (the captain's phone behind the crew
 * grant). The VANS are this screen's subject, so they are listed for every reader allowed on it —
 * van, captains, direction, time: what every board already prints beside a row. The rest of the
 * crew plan — the specialists and the drivers — stays `operationsCrew.view`'s, as on the boards'
 * van cards, and `crewPlanVisible` tells the screen an empty slot was withheld, not empty.
 */
export const getSecuredDistribution = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, OperationsSecuredDistributionQuery>(req);
  const view = await operationsDistributionService.view(query.date);
  const board = boardForReader(req, view);
  const crewPlanVisible = hasPermission(authContext(req), 'operationsCrew.view');
  const dayCrews = new Set(view.vans.map((van) => van.crewAssignmentId));
  ok<OperationsSecuredDistributionDto>(res, {
    date: utcDayIso(view.day),
    today: utcDayIso(view.today),
    crewPlanVisible,
    crews: crewPlanVisible
      ? view.vans
      : view.vans.map((van) => ({ ...van, drivers: [], specialist1: [], specialist2: [] })),
    shipments: board.shipments.map((row) => {
      const receivedAt = view.receivedAt.get(row.id);
      const leg = view.deliveryLeg.get(row.id);
      const placed =
        leg === undefined || !dayCrews.has(String(leg.crewAssignmentId))
          ? null
          : String(leg.crewAssignmentId);
      return {
        ...row,
        vaultReceivedAt: receivedAt === undefined ? null : receivedAt.toISOString(),
        // Due before TODAY (Cairo) and still in the vault — its day has passed, the rule «محصنات
        // الخزينة» marks «متأخرة» by. Only those are listed with a date other than the screen's day.
        overdue:
          row.status === 'inVault' &&
          row.deliveryDate !== null &&
          ymdOf(row.deliveryDate) < ymdOf(view.today),
        delivery:
          leg === undefined
            ? null
            : {
                crewAssignmentId: String(leg.crewAssignmentId),
                captainEmployeeId: String(leg.captainEmployeeId),
                vehicleId: String(leg.vehicleId),
                executionStatus: leg.executionStatus ?? 'pending',
              },
        deliveryLegVersion: leg === undefined ? null : leg.__v,
        placedCrewAssignmentId: placed,
        directionCrewAssignmentIds: view.directionVanIds.get(row.id) ?? [],
      };
    }),
  });
};

/** «حفظ» on «توزيع المحصنات» — every change in one transaction (Round 12). */
export const saveSecuredDistribution = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SaveSecuredDistribution>(req);
  const saved = await operationsDistributionService.save(body, authContext(req).userId);
  ok<OperationsSecuredDistributionSaveDto>(res, {
    date: utcDayIso(saved.date),
    changed: saved.changed,
    rescheduled: saved.rescheduled,
  });
};
