// Violations + grievances (FW-9, legacy car_villes) — ONE screen, TWO LEDGERS side by side.
//
// «مخالفات تتحملها الشركــة» on the right, «مخالفات يتحملها السائقين» on the left. They were a
// filter over one list before, which read as one book with a column for who pays. They are not:
// they are filed differently (a yearly statement whose amount the server derives, versus a
// per-event fine with a person and a day on it), settled by different people, and reported as two
// separate figures a branch is judged on. Two ledgers, so two halves.
//
// This file is the SHELL: the URL state both halves read, and the dialogs either can open. Every
// figure and every rule lives below — in the panels, in the pure libs they call, and behind them
// in the server, which refuses a type filed on the wrong side however the client asks.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  splitVehicleCodeList,
  type FleetViolationDto,
  type FleetViolationRollupDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { type Locale } from '@ecms/contracts';
import { useDeleteViolation } from '../api/fleet-queries';
import { CompanyViolationsPanel } from '../components/CompanyViolationsPanel';
import { DriverViolationsPanel } from '../components/DriverViolationsPanel';
import { CompanyViolationsDetailLayer } from '../components/CompanyViolationsDetailLayer';
import {
  DriverViolationDialog,
  GrievanceDialog,
  VehicleViolationDialog,
} from '../components/ViolationDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/**
 * Remembered across visits. `page` is derived, never kept.
 *
 * Each half keeps its OWN car filter — `codes` for the company board, `dcodes` for the drivers'.
 * One shared filter would mean narrowing the left half every time somebody looked up a car on the
 * right, and the two halves are read side by side precisely so they can disagree.
 */
const REMEMBERED_FILTERS = ['year', 'codes', 'dcodes', 'driver', 'dtype', 'damt', 'size'] as const;

const DEFAULT_PAGE_SIZE = 25;

export const ViolationsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const year = sp.get('year') ?? '';
  const codes = splitVehicleCodeList(sp.get('codes') ?? '');
  const driverCodes = splitVehicleCodeList(sp.get('dcodes') ?? '');
  const driverEmployeeIds = splitVehicleCodeList(sp.get('driver') ?? '');
  const driverAmount = sp.get('damt') ?? '';
  const dtype = sp.get('dtype') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  /** Null or '' deletes the key; any filter change resets the page, as every list screen does. */
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete('page');
    setSp(next, { replace: true });
  };

  const [inspecting, setInspecting] = useState<FleetViolationRollupDto | null>(null);
  const [editing, setEditing] = useState<FleetViolationDto | null>(null);
  const [deleting, setDeleting] = useState<FleetViolationDto | null>(null);
  const [grieving, setGrieving] = useState<FleetViolationRollupDto | null>(null);
  const remove = useDeleteViolation();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
      toast.success(t('fleet.violations.deleted'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  return (
    <PageContainer fullHeight>
      <PageHeader
        title={t('fleet.nav.violations')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.violations') },
        ]}
      />

      {/*
        Company FIRST in the DOM. The app is RTL, so the first child of a row sits on the RIGHT —
        which is where the business reads its own ledger. On a narrow screen the grid collapses to
        one column and the same order becomes top-to-bottom, so the reading order survives.
      */}
      {/* The two ledgers fill whatever the shell left, and the PAGE never scrolls: each panel
          scrolls its own board instead. Comparing the company's total to the drivers' is the whole
          reason these sit side by side, and a page-level scrollbar takes one of them off screen at
          exactly the moment a reader is looking from one to the other. */}
      <div
        data-violations-split="true"
        className="grid min-h-0 min-w-0 flex-1 gap-4 2xl:grid-cols-2"
      >
        <CompanyViolationsPanel
          year={year}
          vehicleCodes={codes}
          onYearChange={(next) => patch({ year: next })}
          onVehicleCodesChange={(next) =>
            patch({ codes: next.length === 0 ? null : next.join(',') })
          }
          onClear={() => patch({ year: null, codes: null })}
          onInspect={setInspecting}
        />
        <DriverViolationsPanel
          vehicleCodes={driverCodes}
          driverEmployeeIds={driverEmployeeIds}
          typeId={dtype}
          amount={driverAmount}
          page={page}
          pageSize={pageSize}
          onVehicleCodesChange={(next) =>
            patch({ dcodes: next.length === 0 ? null : next.join(',') })
          }
          onDriverChange={(next) => patch({ driver: next })}
          onTypeChange={(next) => patch({ dtype: next })}
          onAmountChange={(next) => patch({ damt: next })}
          onClear={() => patch({ dcodes: null, driver: null, dtype: null, damt: null })}
          onPageChange={(next) => patch({ page: String(next) }, false)}
          onPageSizeChange={(next) => patch({ size: String(next), page: null }, false)}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      </div>

      <CompanyViolationsDetailLayer
        row={inspecting}
        onClose={() => setInspecting(null)}
        onEdit={setEditing}
        onDelete={setDeleting}
        onGrievance={(row) => setGrieving(row)}
      />

      {/* The two edit forms, each opened only for the shape it edits. */}
      <VehicleViolationDialog
        open={editing?.kind === 'vehicle'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'vehicle' ? editing : null}
      />
      <DriverViolationDialog
        open={editing?.kind === 'driver'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'driver' ? editing : null}
      />
      {grieving !== null && (
        <GrievanceDialog
          open
          onClose={() => setGrieving(null)}
          vehicleId={grieving.vehicleId}
          code={grieving.code}
          year={grieving.year}
          current={grieving.totalBeforeGrievance}
        />
      )}

      {/* DELETING SHOWS THE FINE, not a sentence about it. The same form the edit path uses,
          read-only, over a delete button: a reader confirming the removal of one of nine fines on
          one car needs to see WHICH one — its year, its kind, its value, its count and what those
          come to. The old dialog asked «are you sure?» about a row it never showed. */}
      <VehicleViolationDialog
        open={deleting?.kind === 'vehicle'}
        onClose={() => setDeleting(null)}
        violation={deleting?.kind === 'vehicle' ? deleting : null}
        mode="delete"
        deleting={remove.isPending}
        onConfirmDelete={() => void confirmDelete()}
      />
      <DriverViolationDialog
        open={deleting?.kind === 'driver'}
        onClose={() => setDeleting(null)}
        violation={deleting?.kind === 'driver' ? deleting : null}
        mode="delete"
        deleting={remove.isPending}
        onConfirmDelete={() => void confirmDelete()}
      />
    </PageContainer>
  );
};
