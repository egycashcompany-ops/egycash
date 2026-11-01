// «عقود توريد السيارات» — the reads and writes as TanStack Query hooks. Every key sits under the
// screen's own subtree (`featureKey('fleet', 'vehicleContracts')`), which is also what the realtime
// registry maps the `fleet.vehicleContract` audit entity onto: somebody else's save reaches an open
// list or contract page the same way this tab's own does.
//
// Declaring `onError` opts a write out of the global error toast (query-client.ts). The writes whose
// refusals the screens word themselves (a stale version, more than is still owed, a make no longer
// active…) raise the global toast only for the rest (`toastUnlessSaid`); the ones whose screens word
// every failure raise none.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateFleetVehicleContract,
  type SaveFleetVehicleContractDelivery,
  type UpdateFleetVehicleContract,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { type UploadProgressOptions } from '../../../shared/lib/api-client';
import { isVehicleContractRefusal } from '../lib/vehicle-contract-words';
import { toastUnlessSaid } from './fleet-queries';
import * as api from './vehicle-contract-api';
import {
  type VehicleContractFilters,
  type VehicleContractListParams,
} from './vehicle-contract-api';

const MODULE = 'fleet';
const FEATURE = 'vehicleContracts';

/** The screen's whole subtree — what every write invalidates. */
export const vehicleContractsKey = featureKey(MODULE, FEATURE);
/** Exported so a spec can seed exactly what a hook reads. */
export const vehicleContractListKey = (params: VehicleContractListParams): readonly unknown[] =>
  listKey(MODULE, FEATURE, params);
export const vehicleContractSummaryKey = (filters: VehicleContractFilters): readonly unknown[] =>
  listKey(MODULE, FEATURE, { summary: true, ...filters });
export const vehicleContractSuppliersKey = [...vehicleContractsKey, 'suppliers'] as const;
export const vehicleContractKey = (id: string): readonly unknown[] =>
  detailKey(MODULE, FEATURE, id);

/**
 * Who words a write's failures:
 *   refusals  the screen words the refusals (`vehicleContractRefusalOf`); the rest go to the
 *             global toast, worded as it always is
 *   all       the screen words every failure itself — a confirm dialog that names what it could
 *             not remove, an upload that names its file — so the global toast would only repeat it
 */
type Words = 'refusals' | 'all';
const saysRefusals = toastUnlessSaid(isVehicleContractRefusal);
const saysAll = (): void => undefined;

export const useVehicleContracts = (params: VehicleContractListParams) =>
  useQuery({
    queryKey: vehicleContractListKey(params),
    queryFn: () => api.listVehicleContracts(params),
    placeholderData: (prev) => prev,
  });

/** «الإحصائيات» over the whole filtered set — the server's sums, never one page's. */
export const useVehicleContractSummary = (filters: VehicleContractFilters, enabled = true) =>
  useQuery({
    queryKey: vehicleContractSummaryKey(filters),
    queryFn: () => api.vehicleContractSummary(filters),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useVehicleContractSuppliers = () =>
  useQuery({
    queryKey: vehicleContractSuppliersKey,
    queryFn: () => api.listVehicleContractSuppliers(),
  });

export const useVehicleContract = (id: string) =>
  useQuery({
    queryKey: vehicleContractKey(id),
    queryFn: () => api.getVehicleContract(id),
    enabled: id !== '',
  });

/** Throws the screen's subtree away — the editor calls it once its whole save sequence is done. */
export const useInvalidateVehicleContracts = (): (() => Promise<void>) => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: vehicleContractsKey });
};

const useContractMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  words: Words,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: vehicleContractsKey }),
    onError: words === 'refusals' ? saysRefusals : saysAll,
  });
};

/** The editor words a make that is no longer active; anything else goes to the global toast. */
export const useCreateVehicleContract = () =>
  useContractMutation(
    (body: CreateFleetVehicleContract) => api.createVehicleContract(body),
    'refusals',
  );

/** The editor words a stale version and the line refusals, and reads the contract again. */
export const useUpdateVehicleContract = () =>
  useContractMutation(
    ({ id, body }: { id: string; body: UpdateFleetVehicleContract }) =>
      api.updateVehicleContract(id, body),
    'refusals',
  );

/** The list's confirm dialog words a failed delete itself. */
export const useDeleteVehicleContract = () =>
  useContractMutation((id: string) => api.deleteVehicleContract(id), 'all');

/**
 * «تسجيل استلام», new or edited: the dialog words a stale version and «more than is still owed»,
 * then reads the contract again.
 */
export const useSaveVehicleContractDelivery = () =>
  useContractMutation(
    ({
      id,
      deliveryId,
      body,
    }: {
      id: string;
      deliveryId: string | null;
      body: SaveFleetVehicleContractDelivery;
    }) =>
      deliveryId === null
        ? api.addVehicleContractDelivery(id, body)
        : api.updateVehicleContractDelivery(id, deliveryId, body),
    'refusals',
  );

/** The contract page's confirm dialog words a failed delete itself. */
export const useDeleteVehicleContractDelivery = () =>
  useContractMutation(
    ({ id, deliveryId }: { id: string; deliveryId: string }) =>
      api.deleteVehicleContractDelivery(id, deliveryId),
    'all',
  );

/**
 * One page added on the contract's page. The section names the file whatever went wrong — refused
 * by type or size, or simply not sent — and says nothing of an upload its reader cancelled.
 */
export const useUploadVehicleContractFile = () =>
  useContractMutation(
    ({ id, file, options }: { id: string; file: File; options?: UploadProgressOptions }) =>
      api.uploadVehicleContractFile(id, file, options),
    'all',
  );

/** The section's confirm dialog words a failed removal itself. */
export const useDeleteVehicleContractFile = () =>
  useContractMutation(
    ({ id, fileId }: { id: string; fileId: string }) => api.deleteVehicleContractFile(id, fileId),
    'all',
  );

/** A reorder that raced an upload or a removal is worded, and the contract read again. */
export const useOrderVehicleContractFiles = () =>
  useContractMutation(
    ({ id, fileIds }: { id: string; fileIds: readonly string[] }) =>
      api.orderVehicleContractFiles(id, fileIds),
    'refusals',
  );
