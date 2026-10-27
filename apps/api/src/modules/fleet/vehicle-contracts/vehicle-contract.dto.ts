// A stored contract as the screens read it: its figures computed (vehicle-contract.figures.ts), the
// makes' names resolved, and only the LIVE deliveries and attachments — soft-deleted ones stay in
// the document and never leave the API.
import {
  type FleetVehicleContractDeliveryDto,
  type FleetVehicleContractDto,
  type FleetVehicleContractFileDto,
  type LocalizedString,
  fleetContractLineTotal,
} from '@ecms/contracts';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import {
  alarmOf,
  dayKey,
  deliveryTotal,
  figuresOf,
  fromPiastres,
  liveDeliveries,
} from './vehicle-contract.figures';
import {
  type FleetVehicleContractDoc,
  type FleetVehicleContractFileLinkDoc,
} from './vehicle-contract.model';

const idOf = (id: { toString(): string }): string => String(id).toLowerCase();

/** The makes' names for a page of contracts — one read; deleted or retired makes still named. */
export const typeNamesFor = async (
  docs: readonly FleetVehicleContractDoc[],
): Promise<Map<string, LocalizedString>> => {
  const ids = new Set<string>();
  for (const doc of docs) for (const line of doc.lines) ids.add(idOf(line.typeId));
  const types = await fleetVehicleTypeRepository.findByIdsSystem([...ids]);
  return new Map(types.map((type) => [idOf(type._id), type.name]));
};

export const toVehicleContractFileDto = (
  link: FleetVehicleContractFileLinkDoc,
): FleetVehicleContractFileDto => ({
  fileId: idOf(link.fileId),
  fileName: link.fileName,
  mime: link.mime,
  size: link.size,
  kind: link.mime === 'application/pdf' ? 'pdf' : 'image',
  addedAt: link.addedAt.toISOString(),
});

export const toVehicleContractDto = (
  doc: FleetVehicleContractDoc,
  typeNames: ReadonlyMap<string, LocalizedString>,
  todayYmd: string,
): FleetVehicleContractDto => {
  const figures = figuresOf(doc);
  let running = 0;
  const deliveries: FleetVehicleContractDeliveryDto[] = liveDeliveries(doc).map(
    (delivery, index) => {
      const total = deliveryTotal(delivery);
      running += total;
      return {
        id: idOf(delivery._id),
        no: index + 1,
        date: dayKey(delivery.date),
        counts: delivery.counts
          .filter((entry) => entry.count > 0)
          .map((entry) => ({ lineId: idOf(entry.lineId), count: entry.count })),
        total,
        receivedAfter: running,
        remainingAfter: Math.max(0, figures.contracted - running),
        createdAt: delivery.createdAt.toISOString(),
        updatedAt: delivery.updatedAt.toISOString(),
      };
    },
  );
  return {
    id: idOf(doc._id),
    no: doc.no,
    name: doc.name ?? '',
    date: dayKey(doc.date),
    deadline: doc.deadline == null ? null : dayKey(doc.deadline),
    supplier: doc.supplier ?? '',
    lines: doc.lines.map((line) => {
      const own = figures.perLine.get(idOf(line._id)) ?? { received: 0, remaining: line.count };
      const unitPrice = line.unitPrice ?? null;
      return {
        id: idOf(line._id),
        typeId: idOf(line.typeId),
        typeName: typeNames.get(idOf(line.typeId)) ?? null,
        count: line.count,
        unitPrice,
        total: fleetContractLineTotal(line.count, unitPrice),
        received: own.received,
        remaining: own.remaining,
      };
    }),
    deliveries,
    files: (doc.files ?? []).filter((link) => link.isDeleted !== true).map(toVehicleContractFileDto),
    contracted: figures.contracted,
    received: figures.received,
    remaining: figures.remaining,
    total: fromPiastres(figures.totalPiastres),
    alarm: alarmOf(doc, todayYmd, figures),
    version: doc.__v,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
};
