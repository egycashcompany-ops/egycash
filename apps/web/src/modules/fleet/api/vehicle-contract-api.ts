// «عقود توريد السيارات» api/ surface (ADR-013): one typed function per endpoint of
// `/fleet/vehicle-contracts`.
//   GET    /summary · /suppliers · / · /:id          the list's figures, the supplier filter, the
//                                                    list, one contract
//   POST   / · PATCH /:id · DELETE /:id              create · edit (whole contract + version) ·
//                                                    soft delete
//   POST   /:id/deliveries · PATCH|DELETE …/:id      «تسجيل استلام» — carries the contract's version
//   POST   /:id/files · GET|DELETE …/:fileId ·       «مرفقات العقد» — never move the version
//   PUT    /:id/files/order
import {
  type CreateFleetVehicleContract,
  type FleetVehicleContractDto,
  type FleetVehicleContractFileDto,
  type FleetVehicleContractTotalsDto,
  type Paginated,
  type SaveFleetVehicleContractDelivery,
  type UpdateFleetVehicleContract,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  fetchBlob,
  get,
  getPage,
  patch,
  post,
  put,
  uploadWithProgress,
  type QueryParams,
  type UploadProgressOptions,
} from '../../../shared/lib/api-client';

const BASE = '/fleet/vehicle-contracts';
const one = (id: string): string => `${BASE}/${encodeURIComponent(id)}`;

/** The list's filters as the address holds them, mapped onto the API's names. */
export interface VehicleContractFilters {
  from?: string;
  to?: string;
  suppliers?: readonly string[];
  typeIds?: readonly string[];
  alarm?: readonly string[];
}

/** A page of the list: the filters, where the reader is, and the order (`sortQuery`). */
export type VehicleContractListParams = VehicleContractFilters &
  QueryParams & { page?: number; pageSize?: number };

export const listVehicleContracts = (
  params: VehicleContractListParams,
): Promise<Paginated<FleetVehicleContractDto>> =>
  getPage<FleetVehicleContractDto>(`${BASE}${buildQuery(params)}`);

/** «الإحصائيات» over every contract the filters match. */
export const vehicleContractSummary = (
  filters: VehicleContractFilters,
): Promise<FleetVehicleContractTotalsDto> =>
  get<FleetVehicleContractTotalsDto>(`${BASE}/summary${buildQuery({ ...filters })}`);

/** The «المورد» filter's options: live, non-empty, distinct, in Arabic order. */
export const listVehicleContractSuppliers = (): Promise<string[]> =>
  get<string[]>(`${BASE}/suppliers`);

export const getVehicleContract = (id: string): Promise<FleetVehicleContractDto> =>
  get<FleetVehicleContractDto>(one(id));

export const createVehicleContract = (
  body: CreateFleetVehicleContract,
): Promise<FleetVehicleContractDto> => post<FleetVehicleContractDto>(BASE, body);

export const updateVehicleContract = (
  id: string,
  body: UpdateFleetVehicleContract,
): Promise<FleetVehicleContractDto> => patch<FleetVehicleContractDto>(one(id), body);

export const deleteVehicleContract = (id: string): Promise<void> => del<void>(one(id));

export const addVehicleContractDelivery = (
  id: string,
  body: SaveFleetVehicleContractDelivery,
): Promise<FleetVehicleContractDto> => post<FleetVehicleContractDto>(`${one(id)}/deliveries`, body);

export const updateVehicleContractDelivery = (
  id: string,
  deliveryId: string,
  body: SaveFleetVehicleContractDelivery,
): Promise<FleetVehicleContractDto> =>
  patch<FleetVehicleContractDto>(`${one(id)}/deliveries/${encodeURIComponent(deliveryId)}`, body);

export const deleteVehicleContractDelivery = (
  id: string,
  deliveryId: string,
): Promise<FleetVehicleContractDto> =>
  del<FleetVehicleContractDto>(`${one(id)}/deliveries/${encodeURIComponent(deliveryId)}`);

/** One page of the contract, with its percentage as it goes up. */
export const uploadVehicleContractFile = (
  id: string,
  file: File,
  options: UploadProgressOptions = {},
): Promise<FleetVehicleContractFileDto> => {
  const form = new FormData();
  form.append('file', file);
  return uploadWithProgress<FleetVehicleContractFileDto>(`${one(id)}/files`, form, options);
};

/** The file's bytes, fetched with the session — shown as an object URL. */
export const fetchVehicleContractFile = (id: string, fileId: string): Promise<Blob> =>
  fetchBlob(`${one(id)}/files/${encodeURIComponent(fileId)}`);

export const deleteVehicleContractFile = (id: string, fileId: string): Promise<void> =>
  del<void>(`${one(id)}/files/${encodeURIComponent(fileId)}`);

/** Every live attachment, each once, in its new order. */
export const orderVehicleContractFiles = (
  id: string,
  fileIds: readonly string[],
): Promise<FleetVehicleContractDto> =>
  put<FleetVehicleContractDto>(`${one(id)}/files/order`, { fileIds });
