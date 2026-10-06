// One insurer's form, filled in — the form on one side, the insurer's page on the other, and every
// answer showing on the page as it is typed.
//
// «ومش عاوز اى داتا اجبارى» — nothing here is required: a notice saves and prints with whatever
// it has, and a box left empty is empty on the paper.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { type FleetNoticeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import {
  useAccidents,
  useCreateNotice,
  useDeleteNotice,
  useDrivers,
  useNotice,
  useNotices,
  useNoticeSettings,
  useUpdateNotice,
  useVehicle,
  useVehicleTypes,
} from '../api/fleet-queries';
import { VehicleCodeCombobox } from '../components/VehicleCodeCombobox';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { useFleetPeopleMap } from '../components/EmployeeName';
import { NoticeSheet } from '../components/NoticeSheet';
import {
  noticeTemplate,
  type NoticeCheck,
  type NoticeField,
  type NoticeTemplate,
} from '../lib/notice-templates';
import { printNoticePages, type NoticeAnswers } from '../lib/notice-render';
import { autofillValues, type NoticeSystemFacts } from '../lib/notice-autofill';
import { handTypedKeys, linkOf, startingValues, withLinked } from '../lib/notice-setup';

/** What a saved notice is called in the list of saved ones: when, and what it is about. */
const savedLabel = (notice: FleetNoticeDto, untitled: string): string => {
  const about = [notice.values['plateNo'], notice.values['driverName']]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
  return `${notice.updatedAt.slice(0, 10)} — ${about === '' ? untitled : about}`;
};

/** The form's mobile, phone, fax and national-id boxes — numbers only. */
const PHONE_FIELD = /(?:Mobile|Phone|Fax|Nid)$/u;

export const NoticeEditorPage = (): JSX.Element => {
  const t = useT();
  const { template: key = '' } = useParams();
  const template = noticeTemplate(key);
  if (template === undefined) {
    return (
      <div className="p-6">
        <EmptyState title={t('fleet.notices.notFound')} />
        <Link to="/fleet/notices" className="mt-4 inline-block text-sm text-brand-600">
          {t('fleet.notices.back')}
        </Link>
      </div>
    );
  }
  return <NoticeEditor key={template.key} template={template} />;
};

const NoticeEditor = ({ template }: { template: NoticeTemplate }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const id = sp.get('id') ?? '';

  const saved = useNotices({ template: template.key, pageSize: 100 });
  const current = useNotice(id);
  const create = useCreateNotice();
  const update = useUpdateNotice();
  const remove = useDeleteNotice();
  const mayWrite = can(id === '' ? 'fleetNotice.create' : 'fleetNotice.edit');
  const mayDelete = can('fleetNotice.delete');

  const [answers, setAnswers] = useState<NoticeAnswers>(() => ({
    values: autofillValues(template, { company: true }),
    checks: {},
  }));
  // The form's set-up — «القيم الافتراضية» a new notice starts with, and the boxes that share one
  // answer («الخانات المتكررة»).
  const settings = useNoticeSettings(template.key);
  const starting = useMemo(
    () => startingValues(template, settings.data),
    [template, settings.data],
  );
  const handTyped = useMemo(() => handTypedKeys(settings.data), [settings.data]);
  const [noticeNumber, setNoticeNumber] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [accidentId, setAccidentId] = useState('');
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [blank, setBlank] = useState(false);
  const pages = useRef<HTMLElement[]>([]);

  // A saved notice, opened: its answers replace whatever is on the form, once per notice.
  const loaded = useRef('');
  useEffect(() => {
    const notice = current.data;
    if (notice === undefined || loaded.current === notice.id) return;
    loaded.current = notice.id;
    setAnswers({ values: notice.values, checks: notice.checks });
    setNoticeNumber(notice.noticeNumber ?? '');
    setNoticeDate(notice.noticeDate?.slice(0, 10) ?? '');
    setVehicleId(notice.vehicleId ?? '');
    setDriverId(notice.driverEmployeeId ?? '');
    setAccidentId(notice.accidentId ?? '');
  }, [current.data]);

  // ── «املأ من النظام» ──────────────────────────────────────────────────────
  // A pick ARMS its group; the facts are written when they have arrived, and only then. Opening a
  // saved notice sets the same three pickers without arming anything, so it never overwrites
  // what was saved.
  const armed = useRef({ vehicle: false, driver: false, accident: false });
  const vehicle = useVehicle(vehicleId);
  const types = useVehicleTypes();
  const people = useFleetPeopleMap();
  const drivers = useDrivers({ employeeIds: [driverId], pageSize: 1 }, driverId !== '');
  const vehicleCode = vehicle.data?.code ?? '';
  const accidents = useAccidents({ vehicleCodes: vehicleCode, pageSize: 50 }, vehicleCode !== '');

  // A new notice takes the set-up's defaults once they have arrived — never a saved one.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || id !== '' || settings.data === undefined) return;
    seeded.current = true;
    setAnswers((prev) => ({ ...prev, values: { ...prev.values, ...starting } }));
  }, [id, settings.data, starting]);

  const fill = (facts: NoticeSystemFacts): void => {
    // A box set to be typed by hand every time is left to the hand.
    const found = Object.fromEntries(
      Object.entries(autofillValues(template, facts)).filter(([key]) => !handTyped.has(key)),
    );
    if (Object.keys(found).length === 0) return;
    setAnswers((prev) => {
      let values = { ...prev.values };
      for (const [key, value] of Object.entries(found)) {
        values = withLinked(template, settings.data, values, key, value);
      }
      return { ...prev, values };
    });
  };

  const typeName = types.data?.items.find((type) => type.id === vehicle.data?.typeId)?.name.ar;
  useEffect(() => {
    if (!armed.current.vehicle || vehicle.data === undefined || vehicle.data.id !== vehicleId)
      return;
    armed.current.vehicle = false;
    fill({ vehicle: vehicle.data, vehicleTypeName: typeName });
  }, [vehicle.data, vehicleId, typeName]);

  const person = people.get(driverId);
  const profile = drivers.data?.items.find((row) => row.employeeId === driverId)?.profile;
  const driverReady = driverId !== '' && person !== undefined && drivers.data !== undefined;
  useEffect(() => {
    if (!armed.current.driver || !driverReady) return;
    armed.current.driver = false;
    fill({ person, profile });
  }, [driverReady, person, profile]);

  const accident = accidents.data?.items.find((row) => row.id === accidentId);
  useEffect(() => {
    if (!armed.current.accident || accident === undefined) return;
    armed.current.accident = false;
    fill({ accident });
  }, [accident]);

  // ── editing ──────────────────────────────────────────────────────────────
  // «تكتب واحدة، الباقي يتملي لوحده» — one answer reaches every box that shares it.
  const setValue = (field: string, value: string): void =>
    setAnswers((prev) => ({
      ...prev,
      values: withLinked(template, settings.data, prev.values, field, value),
    }));
  const toggle = (check: NoticeCheck, option: string): void =>
    setAnswers((prev) => {
      const chosen = prev.checks[check.key] ?? [];
      const next = chosen.includes(option)
        ? chosen.filter((item) => item !== option)
        : check.multiple === true
          ? [...chosen, option]
          : [option];
      return { ...prev, checks: { ...prev.checks, [check.key]: next } };
    });

  const openSaved = (next: string): void => {
    const params = new URLSearchParams(sp);
    if (next === '') params.delete('id');
    else params.set('id', next);
    setSp(params);
  };
  const startNew = (): void => {
    loaded.current = '';
    setAnswers({
      values: { ...autofillValues(template, { company: true }), ...starting },
      checks: {},
    });
    setNoticeNumber('');
    setNoticeDate('');
    setVehicleId('');
    setDriverId('');
    setAccidentId('');
    openSaved('');
  };

  const onSave = async (): Promise<void> => {
    const refs = {
      vehicleId: vehicleId === '' ? null : vehicleId,
      driverEmployeeId: driverId === '' ? null : driverId,
      accidentId: accidentId === '' ? null : accidentId,
      noticeNumber: noticeNumber.trim() === '' ? null : noticeNumber.trim(),
      noticeDate: noticeDate === '' ? null : new Date(noticeDate),
    };
    try {
      if (id === '' || current.data === undefined) {
        const created = await create.mutateAsync({ template: template.key, ...answers, ...refs });
        loaded.current = created.id;
        openSaved(created.id);
      } else {
        await update.mutateAsync({
          id,
          body: { ...answers, ...refs, version: current.data.version },
        });
      }
      toast.success(t('fleet.notices.savedToast'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const onDelete = async (): Promise<void> => {
    if (id === '' || !window.confirm(t('fleet.notices.confirmDelete'))) return;
    try {
      await remove.mutateAsync(id);
      toast.success(t('fleet.notices.deletedToast'));
      startNew();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const onPrint = (): void => {
    try {
      printNoticePages(pages.current, `${template.insurer} — ${template.title}`, blank);
    } catch {
      toast.error(t('fleet.notices.popupBlocked'));
    }
  };

  const untitled = t('fleet.notices.untitled');
  const savedOptions = useMemo(
    () =>
      (saved.data?.items ?? []).map((notice) => ({
        id: notice.id,
        label: savedLabel(notice, untitled),
      })),
    [saved.data, untitled],
  );

  const input = (field: NoticeField): ReactNode => {
    const value = answers.values[field.key] ?? '';
    const common = {
      id: `notice-${field.key}`,
      value,
      'data-notice-field': field.key,
      onFocus: () => setFocus(field.key),
      onBlur: () => setFocus((prev) => (prev === field.key ? undefined : prev)),
      className: cn(focus === field.key && 'border-amber-400 bg-amber-50 dark:bg-amber-950/40'),
    };
    if (field.kind === 'multiline') {
      return (
        <Textarea
          {...common}
          rows={2}
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      );
    }
    return (
      <Input
        {...common}
        type={field.kind === 'date' ? 'date' : 'text'}
        onChange={(event) => setValue(field.key, event.target.value)}
        {...(PHONE_FIELD.test(field.key) ? { rule: 'phone' as const } : {})}
      />
    );
  };

  const checkRow = (check: NoticeCheck): ReactNode => (
    <Field key={check.key} label={check.label} className="mt-3">
      <div className="flex flex-wrap gap-2" data-notice-check={check.key}>
        {check.options.map((option) => {
          const on = (answers.checks[check.key] ?? []).includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(check, option.label)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition',
                on
                  ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {option.label}
            </button>
          );
        })}
        {/* A check that takes SEVERAL answers can be cleared in one press — «امسح اللى اختارته كله». */}
        {check.multiple === true && (answers.checks[check.key] ?? []).length > 0 && (
          <button
            type="button"
            data-notice-check-clear={check.key}
            onClick={() =>
              setAnswers((prev) => ({ ...prev, checks: { ...prev.checks, [check.key]: [] } }))
            }
            className="rounded-full px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {t('common.filters.clearAll')}
          </button>
        )}
      </div>
    </Field>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-notice-editor={template.key}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link
          to="/fleet/notices"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('fleet.notices.back')}
        </Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {template.insurer} — {template.title}
        </h1>
        <span className="flex-1" />
        <div className="w-72">
          <Select
            aria-label={t('fleet.notices.saved')}
            value={id}
            onChange={(event) => openSaved(event.target.value)}
          >
            <option value="">{t('fleet.notices.saved')}</option>
            {savedOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" onClick={startNew}>
          {t('fleet.notices.newNotice')}
        </Button>
        {id !== '' && mayDelete && (
          <Button variant="ghost-danger" onClick={() => void onDelete()} loading={remove.isPending}>
            {t('fleet.notices.delete')}
          </Button>
        )}
        {mayWrite && (
          <Button
            variant="secondary"
            onClick={() => void onSave()}
            loading={create.isPending || update.isPending}
          >
            {t('fleet.notices.save')}
          </Button>
        )}
        <Button onClick={onPrint} data-notice-print>
          {t('fleet.notices.print')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:w-[42%]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            {/* «رقم الإخطار» and its date — what the notices table lists this notice by. */}
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <Field label={t('fleet.notices.number')} htmlFor="notice-meta-number">
                <Input
                  id="notice-meta-number"
                  data-notice-number="true"
                  value={noticeNumber}
                  onChange={(event) => setNoticeNumber(event.target.value)}
                />
              </Field>
              <Field label={t('fleet.notices.date')} htmlFor="notice-meta-date">
                <Input
                  id="notice-meta-date"
                  type="date"
                  data-notice-date="true"
                  value={noticeDate}
                  onChange={(event) => setNoticeDate(event.target.value)}
                />
              </Field>
            </div>
            <h2 className="mb-2 text-sm font-bold text-brand-700 dark:text-brand-300">
              {t('fleet.notices.fromSystem')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('fleet.notices.vehicle')}>
                <VehicleCodeCombobox
                  value={vehicleId}
                  anyStatus
                  ariaLabel={t('fleet.notices.vehicle')}
                  placeholder={t('fleet.notices.none')}
                  onChange={(next) => {
                    armed.current.vehicle = next !== '';
                    setVehicleId(next);
                    setAccidentId('');
                  }}
                />
              </Field>
              <Field label={t('fleet.notices.driver')}>
                <RegistryDriverPicker
                  value={driverId === '' ? [] : [driverId]}
                  fullWidth
                  className="w-full"
                  onChange={(next) => {
                    const picked = next[0] ?? '';
                    armed.current.driver = picked !== '';
                    setDriverId(picked);
                  }}
                />
              </Field>
              <Field label={t('fleet.notices.accident')}>
                <Select
                  value={accidentId}
                  disabled={vehicleCode === ''}
                  onChange={(event) => {
                    armed.current.accident = event.target.value !== '';
                    setAccidentId(event.target.value);
                  }}
                >
                  <option value="">{t('fleet.notices.none')}</option>
                  {(accidents.data?.items ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {`${row.occurredAt?.slice(0, 10) ?? '—'} · ${row.statement.slice(0, 40)}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.notices.optionalHint')}
            </p>
          </div>

          {template.sections.map((section) => (
            <div key={section.title} className="mt-5">
              <h2 className="mb-2 border-b border-brand-100 pb-1 text-sm font-bold text-brand-700 dark:border-brand-900 dark:text-brand-300">
                {section.title}
                {template.pages.length > 1 && section.fields.every((field) => field.page > 0) && (
                  <span className="ms-2 text-xs font-normal text-slate-500">
                    {t('fleet.notices.pageN', { page: '2' })}
                  </span>
                )}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    htmlFor={`notice-${field.key}`}
                    className={cn(field.kind === 'multiline' && 'sm:col-span-2')}
                  >
                    {input(field)}
                    <FieldTags
                      link={linkOf(settings.data, field.key)?.name}
                      isDefault={
                        (starting[field.key] ?? '') !== '' &&
                        (answers.values[field.key] ?? '') === starting[field.key]
                      }
                    />
                  </Field>
                ))}
              </div>
              {template.checks
                .filter((check) => check.afterSection === section.title)
                .map(checkRow)}
            </div>
          ))}
        </section>

        <section className="min-h-0 flex-1 overflow-auto rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
          <div className="mx-auto mb-3 flex max-w-[640px] items-center gap-2">
            <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">
              {t('fleet.notices.preview')}
            </span>
            <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-600">
              {([false, true] as const).map((mode) => (
                <button
                  key={String(mode)}
                  type="button"
                  aria-pressed={blank === mode}
                  data-notice-mode={mode ? 'blank' : 'full'}
                  onClick={() => setBlank(mode)}
                  className={cn(
                    'px-3 py-1.5',
                    blank === mode
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200',
                  )}
                >
                  {mode ? t('fleet.notices.modeBlank') : t('fleet.notices.modeFull')}
                </button>
              ))}
            </div>
          </div>
          <NoticeSheet
            template={template}
            answers={answers}
            focus={focus}
            blank={blank}
            pagesRef={pages}
          />
        </section>
      </div>
    </div>
  );
};

/** Under a box: «افتراضي» while it holds its set-up's default, and the group it shares. */
const FieldTags = ({
  link,
  isDefault,
}: {
  link: string | undefined;
  isDefault: boolean;
}): JSX.Element | null => {
  const t = useT();
  if (link === undefined && !isDefault) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {isDefault && (
        <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:text-brand-200">
          {t('fleet.notices.defaultTag')}
        </span>
      )}
      {link !== undefined && (
        <span
          data-notice-linked="true"
          className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300"
        >
          {t('fleet.notices.linkedTag', { name: link })}
        </span>
      )}
    </span>
  );
};
