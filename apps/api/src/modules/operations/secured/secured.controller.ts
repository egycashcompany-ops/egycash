// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type AssignSecuredDeliveryLeg,
  type DispatchSecuredShipments,
  type ListSecuredBacklogQuery,
  type ListSecuredDueQuery,
  type ListVaultInventoryQuery,
  type ReceiveIntoVault,
} from '@ecms/contracts';
import { ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import {
  toShipmentAssignmentDto,
  toShipmentDto,
  toVaultInventoryRowDto,
} from '../operations.mappers';
import { vaultCustody } from '../treasury-boundary';
import { operationsSecuredService } from './secured.service';

type IdParam = { id: string };

export const listBacklog = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListSecuredBacklogQuery>(req);
  okPage(res, await operationsSecuredService.backlog(query), toShipmentDto);
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
