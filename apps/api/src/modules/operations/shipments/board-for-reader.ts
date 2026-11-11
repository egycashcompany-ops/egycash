// The board rows of every Operations screen that prints them — the day board, the history, the
// deleted list, the secured screen and the vault's receive queue — mapped for THE READER. HTTP-layer
// only (it reads the caller's grants off the request); the rows themselves come from
// `operationsShipmentService.boardView`, so all five screens print a shipment the same way and gate
// the crew plan the same way.
import { type Request } from 'express';
import { type OperationsDayBoardDto } from '@ecms/contracts';
import { authContext } from '../../../platform/auth';
import { hasPermission } from '../../../shared/types';
import { toShipmentDto } from '../operations.mappers';
import { type DayBoardView } from './shipment.service';

/**
 * Who rides which van, and how to reach its captain, is the crew plan — `operationsCrew.view`'s,
 * the crew board's own grant. The boards themselves ride their screen's grant, so a reader without
 * the crew grant still sees the van and the captain's name the legacy table printed, but not the
 * van's card or the captain's phone.
 */
const seesCrewPlan = (req: Request): boolean =>
  hasPermission(authContext(req), 'operationsCrew.view');

/** A resolved operating day on the wire: its UTC midnight, as an ISO string. */
export const utcDayIso = (d: Date): string =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();

/**
 * The rows and van cards of a board, mapped for THIS reader — the one place the crew plan is
 * taken back out for a reader without `operationsCrew.view`. Every board-shaped answer goes
 * through it, so a crew fact gated on one screen can never leak through another.
 */
export const boardForReader = (
  req: Request,
  { rows, crews }: DayBoardView,
): Pick<OperationsDayBoardDto, 'shipments' | 'crews'> => {
  const crewPlan = seesCrewPlan(req);
  return {
    shipments: rows.map(
      ({
        doc,
        origin,
        destination,
        crew,
        captainDeliveredAt,
        securedStage,
        captainPickedUpAt,
        pickedUpBy,
        pickedUpAt,
      }) => ({
        ...toShipmentDto(doc),
        origin,
        destination,
        crew: crew === null || crewPlan ? crew : { ...crew, captainPhone: null },
        captainDeliveredAt: captainDeliveredAt === null ? null : captainDeliveredAt.toISOString(),
        securedStage,
        captainPickedUpAt: captainPickedUpAt === null ? null : captainPickedUpAt.toISOString(),
        pickedUpBy,
        pickedUpAt: pickedUpAt === null ? null : pickedUpAt.toISOString(),
      }),
    ),
    crews: crewPlan ? crews : [],
  };
};
