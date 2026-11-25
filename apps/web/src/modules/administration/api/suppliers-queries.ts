// TanStack Query hooks for the supplier register (ADR-013). Every write — a supplier's create or
// edit, a paper filed or removed — answers the record's detail and re-reads the `suppliers`
// subtree, the register and the record alike; a refusal for a moved `version` (409
// `STALE_DOCUMENT`) re-reads it too, so the screen behind the dialog shows the supplier as it now
// is (`useAdministrationWrite`).
//
// A paper still being scanned is not signalled when the scanner answers (no audit row, so no
// realtime signal, §11.5), so the record reads itself again with backoff while one is pending, and
// stops once none is. The backoff is measured from when a paper was first seen pending, in time
// rather than in reads, so a paper filed late in a session is first re-read after five seconds and a
// write's realtime echo does not skip a step.
import { useQuery } from '@tanstack/react-query';
import {
  type CreateAdministrationSupplier,
  type UpdateAdministrationSupplier,
} from '@ecms/contracts';
import { nextScanWait, scanRecheckDelay, type ScanWait } from '../lib/supplier-view';
import { administrationKeys, supplierKey, supplierListKey } from './administration-keys';
import { useAdministrationWrite } from './catalog-queries';
import { type AdministrationListParams } from './catalog-api';
import * as api from './suppliers-api';

export const useAdministrationSuppliers = (params: AdministrationListParams, enabled = true) =>
  useQuery({
    queryKey: supplierListKey(params),
    queryFn: () => api.listSuppliers(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/** Each cached record's scan wait, kept with its cache entry and dropped once none is pending. */
const scanWaits = new WeakMap<object, ScanWait>();

export const useAdministrationSupplier = (id: string) =>
  useQuery({
    queryKey: supplierKey(id),
    queryFn: () => api.getSupplier(id),
    enabled: id !== '',
    retry: false,
    refetchInterval: (query) => {
      const now = Date.now();
      const wait = nextScanWait(query.state.data?.attachments, now, scanWaits.get(query));
      if (wait === undefined) {
        scanWaits.delete(query);
        return false;
      }
      scanWaits.set(query, wait);
      return scanRecheckDelay(query.state.data?.attachments, now - wait.since);
    },
  });

const SUPPLIER_SUBTREES = [administrationKeys.suppliers] as const;

export const useCreateSupplier = () =>
  useAdministrationWrite(
    (body: CreateAdministrationSupplier) => api.createSupplier(body),
    SUPPLIER_SUBTREES,
  );

export const useUpdateSupplier = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationSupplier }) =>
      api.updateSupplier(id, body),
    SUPPLIER_SUBTREES,
  );

export const useAddSupplierPaper = () =>
  useAdministrationWrite(
    (input: api.AddSupplierPaperInput) => api.addSupplierPaper(input),
    SUPPLIER_SUBTREES,
  );

export const useRemoveSupplierPaper = () =>
  useAdministrationWrite(
    (input: { id: string; attachmentId: string; version: number }) =>
      api.removeSupplierPaper(input),
    SUPPLIER_SUBTREES,
  );
