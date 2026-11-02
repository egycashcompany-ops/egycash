// «عقد جديد» / «تعديل العقد» — the owner's approved forms sample (`zz-contracts-forms-editor`), laid
// out as the custody memo editor is: the form column (the contract's facts, its lines, and a footer
// that keeps the total and Save in view) and, where the editors keep their paper, the contract's own
// pages — several images and/or PDF files, in their order.
//
// Only what the owner requires is required: the contract's date and at least one line (a make and
// a count of 1 or more). Name, supplier, «آخر موعد للتوريد» and the unit price are optional.
//
// SAVE is one sequence (`saveContractWithFiles`): the contract first — refused, nothing else is
// sent and the form stays open — then the files, each showing its percentage as it goes up, then
// their order. A file that fails does not undo the contract: the screen names it, and it can be
// added again from the contract's page.
//
// «المستلم حتى الآن» (batch 3): on «عقد جديد» a holder of «تسجيل استلام» may write, per line, the
// cars that already arrived. While anything is written, «تاريخ الاستلام» (today until changed)
// shows under the lines with what Save records — the contract's «الاستلام الأول» — and the footer
// adds «— المستلم 26 · المتبقي 7». A box over its line's count turns rose and Save waits. Only the
// create body carries them; on «تعديل العقد» the column is the saved figure, locked, and the
// update body is as before (received cars change through «الاستلامات» on the contract's page).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { type FleetVehicleContractDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import * as api from '../api/vehicle-contract-api';
import {
  useCreateVehicleContract,
  useInvalidateVehicleContracts,
  useUpdateVehicleContract,
  useVehicleContract,
} from '../api/vehicle-contract-queries';
import { DesignSave } from '../components/DesignDialog';
import { DesignField, LOOK, MONO, SANS, boxTone } from '../components/FuelCardDialog';
import { PATH, ymd } from '../components/FuelCardBoard';
import { DESIGN_BACK, DesignPageHeader, today } from '../components/LicenseExpensePaidGroup';
import { MEMO_ICON, Money, SectionHead } from '../components/custody-memo-parts';
import {
  ReceivedTotals,
  VehicleContractLinesEditor,
  countKey,
  lineInvalid,
  makeKey,
} from '../components/VehicleContractLinesEditor';
import { AttachmentsTray, savedFiles } from '../components/VehicleContractTray';
import { VehicleContractViewer } from '../components/VehicleContractViewer';
import { type ShownFile } from '../components/VehicleContractAttachments';
import {
  createBodyOf,
  editorReceived,
  editorTotals,
  moveItem,
  receivedModeOf,
  typedCount,
  updateBodyOf,
  type EditorForm,
  type EditorLine,
} from '../lib/vehicle-contract-figures';
import { saveContractWithFiles, type TrayItem } from '../lib/vehicle-contract-save';
import {
  REFUSAL_KEY,
  latin,
  useVehicleContractWords,
  vehicleContractRefusalOf,
} from '../lib/vehicle-contract-words';

const BOX = boxTone(LOOK.add);
const DATE_BOX = cn(BOX, MONO);

let nextKey = 0;
const newKey = (): string => {
  nextKey += 1;
  return `k${nextKey}`;
};
const emptyLine = (): EditorLine => ({
  key: newKey(),
  id: null,
  typeId: '',
  count: '',
  price: '',
  received: '',
});

const formOf = (contract: FleetVehicleContractDto): EditorForm => ({
  date: contract.date,
  deadline: contract.deadline ?? '',
  name: contract.name,
  supplier: contract.supplier,
  lines: contract.lines.map((line) => ({
    key: line.id,
    id: line.id,
    typeId: line.typeId,
    count: String(line.count),
    price: line.unitPrice === null ? '' : String(line.unitPrice),
    received: String(line.received),
  })),
  receivedDate: today(),
});

const trayOf = (contract: FleetVehicleContractDto): TrayItem[] =>
  contract.files.map((file) => ({ kind: 'saved', key: file.fileId, file }));

export const VehicleContractEditorPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const words = useVehicleContractWords();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const editing = id !== '';
  const contract = useVehicleContract(id);
  const create = useCreateVehicleContract();
  const update = useUpdateVehicleContract();
  const invalidate = useInvalidateVehicleContracts();
  // An edit opens on the contract as it was read (at once when it is already in hand) — and again
  // after a refused, stale save.
  const loaded = contract.data;
  const [form, setForm] = useState<EditorForm>(() =>
    loaded === undefined
      ? {
          date: today(),
          deadline: '',
          name: '',
          supplier: '',
          lines: [emptyLine()],
          receivedDate: today(),
        }
      : formOf(loaded),
  );
  const [tray, setTray] = useState<TrayItem[]>(() => (loaded === undefined ? [] : trayOf(loaded)));
  const [viewing, setViewing] = useState<number | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const [readVersion, setReadVersion] = useState<number | null>(loaded?.version ?? null);
  useEffect(() => {
    if (loaded === undefined || loaded.version === readVersion) return;
    setReadVersion(loaded.version);
    setForm(formOf(loaded));
    setTray((held) => [...trayOf(loaded), ...held.filter((item) => item.kind === 'pending')]);
  }, [loaded, readVersion]);

  // «… يجيلوا مسدج انه فى كذا وكذا وكذا المفروض يدخلهم والخانات نفسها تتقلب باللون الاحمر»: Save
  // stays pressable; a press with a value missing names it in the banner and turns its box red.
  // Only the contract's date and each line's make and count are required.
  const required = useRequiredFields([
    { key: 'date', label: t('fleet.vehicleContracts.fields.date'), ok: form.date !== '' },
    ...form.lines.flatMap((line, index) => {
      const at = ` (${latin(index + 1)})`;
      return [
        {
          key: makeKey(line),
          label: `${t('fleet.vehicleContracts.lines.make')}${at}`,
          ok: line.typeId !== '',
        },
        {
          key: countKey(line),
          label: `${t('fleet.vehicleContracts.lines.count')}${at}`,
          ok: typedCount(line.count) >= 1,
        },
      ];
    }),
  ]);

  if (editing && loaded === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const set = (change: Partial<EditorForm>): void => setForm((held) => ({ ...held, ...change }));
  const receivedOf = (line: EditorLine): number =>
    loaded?.lines.find((each) => each.id === line.id)?.received ?? 0;
  const totals = editorTotals(form.lines);
  // Typed on a new contract by a holder of «تسجيل استلام»; the saved figure on an edit.
  const receivedMode = receivedModeOf(editing, can('fleetVehicleContract.receive'));
  const arrived = editorReceived(form.lines, receivedMode, loaded?.received ?? 0);
  // A received box over its line's count: the box is rose, the note under the table names the
  // make, and Save waits — as «تسجيل استلام» does. Never over a missing value.
  const anyReceivedOver = arrived.over.length > 0;
  const shown: ShownFile[] = tray.map((item) =>
    item.kind === 'saved'
      ? (savedFiles({ id, files: [item.file] })[0] as ShownFile)
      : {
          key: item.key,
          fileName: item.file.name,
          mime: item.file.type,
          size: item.file.size,
          saved: null,
          local: item.file,
          progress: item.progress,
        },
  );

  const removeFromTray = (key: string): void => {
    controllers.current.get(key)?.abort();
    setTray((held) => held.filter((item) => item.key !== key));
  };

  const onSave = async (): Promise<void> => {
    const invalid = form.lines.some(
      (line) => lineInvalid(line, receivedOf(line), receivedMode) !== null,
    );
    setShowInvalid(invalid);
    if (invalid || busy) return;
    for (const item of tray) {
      if (item.kind === 'pending') controllers.current.set(item.key, new AbortController());
    }
    setBusy(true);
    try {
      const result = await saveContractWithFiles(
        {
          create: (input) => create.mutateAsync(input),
          update: (contractId, input) => update.mutateAsync({ id: contractId, body: input }),
          upload: (contractId, file, options) =>
            api.uploadVehicleContractFile(contractId, file, options),
          removeFile: (contractId, fileId) => api.deleteVehicleContractFile(contractId, fileId),
          order: (contractId, fileIds) => api.orderVehicleContractFiles(contractId, fileIds),
        },
        loaded === undefined
          ? { mode: 'create', body: createBodyOf(form, receivedMode), items: tray }
          : {
              mode: 'update',
              id: loaded.id,
              body: updateBodyOf(form, loaded.version),
              before: loaded.files,
              items: tray,
            },
        {
          onProgress: (key, progress) =>
            setTray((held) =>
              held.map((item) =>
                item.key === key && item.kind === 'pending' ? { ...item, progress } : item,
              ),
            ),
          signalOf: (key) => controllers.current.get(key)?.signal,
        },
      );
      await invalidate();
      if (result.failed.length > 0) {
        toast.warning(
          t('fleet.vehicleContracts.savedWithoutFiles', {
            files: result.failed.map((name) => `«${name}»`).join('، '),
          }),
        );
      } else if (result.orderRefused) toast.warning(t('fleet.vehicleContracts.orderRefused'));
      else toast.success(t('fleet.vehicleContracts.savedToast'));
      navigate(`/fleet/vehicle-contracts/${encodeURIComponent(result.contract.id)}`);
    } catch (failure) {
      // The contract was refused, so nothing else went: the files wait in the tray, unsent.
      setTray((held) =>
        held.map((item) => (item.kind === 'pending' ? { ...item, progress: null } : item)),
      );
      const refusal = vehicleContractRefusalOf(failure);
      if (refusal !== null) toast.error(t(REFUSAL_KEY[refusal]));
      if (refusal === 'stale' || refusal === 'unknownLine' || refusal === 'lineReceived') {
        void contract.refetch();
      }
    } finally {
      controllers.current.clear();
      setBusy(false);
    }
  };

  const title = editing
    ? t('fleet.vehicleContracts.editor.editTitle')
    : t('fleet.vehicleContracts.new');
  const subtitle =
    loaded === undefined
      ? t('fleet.vehicleContracts.editor.newSubtitle')
      : t('fleet.vehicleContracts.subtitle', { no: latin(loaded.no), date: ymd(loaded.date) });
  const back =
    loaded === undefined ? '/fleet/vehicle-contracts' : `/fleet/vehicle-contracts/${loaded.id}`;
  return (
    <div className="flex flex-col" data-contract-editor={editing ? 'edit' : 'new'}>
      <DesignPageHeader icon={MEMO_ICON} title={title} subtitle={subtitle}>
        <Link to={back} className={DESIGN_BACK}>
          {t('fleet.vehicleContracts.back')}
        </Link>
      </DesignPageHeader>

      {/* Both columns as tall as the taller one's content; with a long contract the page scrolls
          with Save kept in view. */}
      <div className="flex flex-col gap-4 p-3 sm:p-4 lg:flex-row lg:items-stretch">
        <section
          className={cn(
            SANS,
            'flex flex-col rounded-2xl border text-slate-900 antialiased dark:text-slate-100',
            // 62% → 68% where the received column shows, so the lines table keeps every box whole.
            receivedMode === 'hidden' ? 'lg:w-[62%]' : 'lg:w-[68%]',
            'border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#121c3f]/95',
          )}
        >
          <div className="flex-1 space-y-5 p-4 sm:px-6 sm:pb-5 sm:pt-4" data-contract-form="true">
            <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
            <section className="space-y-4">
              <SectionHead title={t('fleet.vehicleContracts.section.data')} icon={PATH.calendar} />
              {/* «آخر موعد للتوريد» right beside «تاريخ العقد» — one row, the name after them. */}
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[12rem_12rem_1fr] sm:gap-x-5 sm:gap-y-3">
                <DesignField
                  label={t('fleet.vehicleContracts.fields.date')}
                  missing={required.isMissing('date')}
                  datePicker
                >
                  <Input
                    type="date"
                    dir="ltr"
                    aria-label={t('fleet.vehicleContracts.fields.date')}
                    value={form.date}
                    onChange={(e) => set({ date: e.target.value })}
                    tone={DATE_BOX}
                    data-contract-date="true"
                  />
                </DesignField>
                <DesignField
                  label={`${t('fleet.vehicleContracts.fields.deadline')} (${t('fleet.vehicleContracts.optional')})`}
                  datePicker
                >
                  <Input
                    type="date"
                    dir="ltr"
                    aria-label={t('fleet.vehicleContracts.fields.deadline')}
                    value={form.deadline}
                    onChange={(e) => set({ deadline: e.target.value })}
                    tone={DATE_BOX}
                    data-contract-deadline="true"
                  />
                </DesignField>
                <DesignField
                  label={`${t('fleet.vehicleContracts.fields.name')} (${t('fleet.vehicleContracts.optional')})`}
                >
                  <Input
                    aria-label={t('fleet.vehicleContracts.fields.name')}
                    value={form.name}
                    maxLength={200}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder={t('fleet.vehicleContracts.fields.namePlaceholder')}
                    tone={BOX}
                    data-contract-name-box="true"
                  />
                </DesignField>
                <div className="sm:col-span-3">
                  <DesignField
                    label={`${t('fleet.vehicleContracts.fields.supplier')} (${t('fleet.vehicleContracts.optional')})`}
                  >
                    <Input
                      aria-label={t('fleet.vehicleContracts.fields.supplier')}
                      value={form.supplier}
                      maxLength={200}
                      onChange={(e) => set({ supplier: e.target.value })}
                      placeholder={t('fleet.vehicleContracts.fields.supplierPlaceholder')}
                      tone={BOX}
                      data-contract-supplier-box="true"
                    />
                  </DesignField>
                </div>
              </div>
            </section>

            <VehicleContractLinesEditor
              lines={form.lines}
              receivedOf={receivedOf}
              receivedMode={receivedMode}
              receivedDate={form.receivedDate}
              onReceivedDate={(day) => set({ receivedDate: day })}
              isMissing={required.isMissing}
              showInvalid={showInvalid}
              onChange={(key, change) =>
                set({
                  lines: form.lines.map((line) =>
                    line.key === key ? { ...line, ...change } : line,
                  ),
                })
              }
              onAdd={() => set({ lines: [...form.lines, emptyLine()] })}
              onRemove={(key) => set({ lines: form.lines.filter((line) => line.key !== key) })}
            />
          </div>

          {/* The contract's figure and Save — kept in view while the lines scroll. */}
          <footer
            data-contract-footer="true"
            className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:px-6 dark:border-[#2b3b6b] dark:bg-[#0f1838]/95"
          >
            {/* The figures wrap inside their line on a desk, so Save keeps its place; on a phone
                Save goes under them, as before. */}
            <p className="flex min-w-0 flex-1 basis-[24rem] flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-slate-800 dark:text-slate-100">
              <span>{t('fleet.vehicleContracts.total.label')}</span>
              <span data-contract-total={totals.total}>
                <Money value={totals.total} big className="text-slate-900 dark:text-white" small />
              </span>
              <span className="text-slate-400">—</span>
              <span className="text-emerald-700 dark:text-emerald-300">
                {words.count('car', totals.cars)}
              </span>
              <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {words.inLines(totals.priced === 0 ? form.lines.length : totals.priced)}
              </span>
              {/* «— المستلم 26 · المتبقي 7» once something arrived. */}
              {arrived.received > 0 && (
                <ReceivedTotals
                  received={arrived.received}
                  left={arrived.left}
                  over={anyReceivedOver}
                />
              )}
            </p>
            <DesignSave
              label={t('fleet.vehicleContracts.save')}
              onClick={required.guard(() => onSave())}
              busy={busy}
              disabled={anyReceivedOver}
              data-contract-save="true"
            />
          </footer>
        </section>

        <AttachmentsTray
          files={shown}
          busy={busy}
          onAdd={(files) =>
            setTray((held) => [
              ...held,
              ...files.map((file): TrayItem => ({
                kind: 'pending',
                key: newKey(),
                file,
                progress: null,
              })),
            ])
          }
          onView={setViewing}
          onRemove={removeFromTray}
          onMove={(from, to) => setTray((held) => moveItem(held, from, to))}
        />
      </div>
      <VehicleContractViewer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        files={shown}
        index={viewing ?? 0}
        onIndex={setViewing}
        subtitle={`${title} · ${words.count('file', shown.length)}`}
      />
    </div>
  );
};
