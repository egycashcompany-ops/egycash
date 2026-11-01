// Dedicated National-ID OCR review screen (modal). The card as the reader saw it and the holder's
// photograph sit beside EVERY extracted field, so each value is checked against the card itself
// rather than from memory; each field shows how sure the reader was. The number-derived fields
// (birth date / gender / governorate) recompute live and stay read-only. Only on Confirm is the
// reviewed data handed back to the caller — nothing is saved here. Each side, the photo and the values
// can be downloaded, as on the Readers page. Module-agnostic (uses the generic `nationalIdOcr.*` catalog), so it is reusable.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { MARITAL_STATUSES } from '@ecms/contracts';
import { useT } from '../../platform/localization/useT';
import { useAppSelector } from '../../store';
import { cn } from '../lib/cn';
import { formatDate } from '../lib/format';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge, type Tone } from '../ui/Badge';
import { Field, Input, Select } from '../ui/form';
import { EgycashLogo } from '../ui/EgycashLogo';
import {
  AlertIcon,
  BadgeIcon,
  CheckIcon,
  DownloadIcon,
  ImageIcon,
  PinIcon,
  UserIcon,
  UsersIcon,
} from '../ui/icons';
import { fileStem, saveCsv, saveUrl } from './download';
import { deriveFromNationalId } from './mapping';
import { type NationalIdReviewData, type NationalIdReviewMeta, type OcrConfidence } from './types';

const CONFIDENCE_TONE: Record<OcrConfidence, Tone> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
};

/** How a field's box looks for how sure the reader was: a doubtful value asks to be checked. */
const BOX: Record<OcrConfidence | 'edited' | 'none', string> = {
  high: '',
  none: '',
  medium: 'border-amber-300 bg-amber-50/60 dark:border-amber-700/70 dark:bg-amber-950/20',
  low: 'border-red-300 bg-red-50/60 dark:border-red-800/70 dark:bg-red-950/20',
  edited: 'border-brand-300 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-950/20',
};

const BOX_BASE =
  'min-h-[44px] rounded-xl px-3.5 text-[15px] transition-colors focus:ring-4 focus:ring-brand-500/10';

/** A field label with the reader's confidence beside it, or 'edited' once the user changed it. */
const Labelled = ({
  id,
  label,
  confidence,
  edited = false,
  children,
}: {
  id: string;
  label: string;
  confidence?: OcrConfidence | undefined;
  edited?: boolean;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[13px] font-semibold text-slate-600 dark:text-slate-300"
        >
          {label}
        </label>
        {edited ? (
          <Badge size="sm" tone="brand">
            {t('nationalIdOcr.review.edited')}
          </Badge>
        ) : (
          confidence !== undefined && (
            <Badge size="sm" tone={CONFIDENCE_TONE[confidence]}>
              {t(`nationalIdOcr.confidence.${confidence}`)}
            </Badge>
          )
        )}
      </div>
      {children}
      {!edited && (confidence === 'low' || confidence === 'medium') && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('nationalIdOcr.review.checkThis')}
        </p>
      )}
    </div>
  );
};

/** One group of related fields, titled, in a soft box. */
const Group = ({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}): JSX.Element => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-slate-900/60">
    <h4 className="mb-3.5 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300">
        {icon}
      </span>
      {title}
    </h4>
    {children}
  </section>
);

/** A quiet outline button with a download arrow — saves something shown in the review. */
const DownloadButton = ({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex min-h-[36px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-950/40 dark:hover:text-brand-200',
      className,
    )}
  >
    <DownloadIcon className="h-4 w-4 shrink-0" />
    {label}
  </button>
);

/** The card as read (or as uploaded, when the reader returned no image), front or back. */
const CardPanel = ({ meta, stem }: { meta: NationalIdReviewMeta; stem: string }): JSX.Element => {
  const t = useT();
  const sides = (
    [
      ['front', meta.cardFront ?? meta.uploadedFront, meta.cardFront !== undefined],
      ['back', meta.cardBack ?? meta.uploadedBack, meta.cardBack !== undefined],
    ] as const
  ).filter(([, src]) => src !== undefined);
  const [side, setSide] = useState<'front' | 'back'>(sides[0]?.[0] ?? 'front');
  const current = sides.find(([s]) => s === side) ?? sides[0];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {current !== undefined && !current[2]
            ? t('nationalIdOcr.review.uploaded')
            : t('nationalIdOcr.review.cardAsRead')}
        </h3>
        {sides.length > 1 && (
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {sides.map(([s]) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  s === side
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {t(
                  s === 'front'
                    ? 'nationalIdOcr.review.sideFront'
                    : 'nationalIdOcr.review.sideBack',
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative flex aspect-[1.586] w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-900 shadow-lg shadow-slate-900/10 ring-1 ring-slate-200 dark:ring-slate-700">
        {current !== undefined && (
          <>
            <span className="pointer-events-none absolute start-2.5 top-2.5 z-10 h-5 w-5 rounded-ss-lg border-[2.5px] border-b-0 border-e-0 border-white/90" />
            <span className="pointer-events-none absolute end-2.5 top-2.5 z-10 h-5 w-5 rounded-se-lg border-[2.5px] border-b-0 border-s-0 border-white/90" />
            <span className="pointer-events-none absolute bottom-2.5 start-2.5 z-10 h-5 w-5 rounded-es-lg border-[2.5px] border-e-0 border-t-0 border-white/90" />
            <span className="pointer-events-none absolute bottom-2.5 end-2.5 z-10 h-5 w-5 rounded-ee-lg border-[2.5px] border-s-0 border-t-0 border-white/90" />
          </>
        )}
        {current !== undefined ? (
          <img
            src={current[1]}
            alt={t('nationalIdOcr.review.cardAsRead')}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-sm text-slate-400">
            <ImageIcon className="h-6 w-6" />
            {t('nationalIdOcr.review.noCard')}
          </div>
        )}
      </div>
      {current !== undefined && (
        <DownloadButton
          className="w-full"
          label={`${t('nationalIdOcr.review.download')} — ${t(
            current[0] === 'front'
              ? 'nationalIdOcr.review.sideFront'
              : 'nationalIdOcr.review.sideBack',
          )}`}
          onClick={() => {
            if (current[1] !== undefined) saveUrl(current[1], `${stem}-${current[0]}.jpg`);
          }}
        />
      )}
    </section>
  );
};

export const NationalIdReviewDialog = ({
  open,
  initial,
  meta,
  notice,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initial: NationalIdReviewData;
  /** Confidence per field and the card images, shown beside the values. */
  meta?: NationalIdReviewMeta | undefined;
  /** Optional inline notice (e.g. "OCR unavailable — enter the values manually"). */
  notice?: string | undefined;
  onCancel: () => void;
  onConfirm: (data: NationalIdReviewData) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [d, setD] = useState<NationalIdReviewData>(initial);
  const ids = useId();
  const id = (name: string): string => `${ids}-${name}`;

  // Re-seed whenever a fresh extraction opens the dialog.
  useEffect(() => {
    if (open) setD(initial);
  }, [open, initial]);

  const set = (patch: Partial<NationalIdReviewData>): void =>
    setD((prev) => ({ ...prev, ...patch }));
  const derived = deriveFromNationalId(d.nationalId);
  const confidence = meta?.confidence ?? {};
  // A value the user changed is theirs now: the reader's confidence no longer describes it.
  const sure = (key: keyof NationalIdReviewMeta['confidence']): OcrConfidence | undefined =>
    d[key] === initial[key] ? confidence[key] : undefined;

  const confirm = (): void => onConfirm({ ...d, ...derived });

  // Downloads carry the values as they stand now, edits included, labelled in the screen's language.
  const stem = fileStem(d.nationalId);
  const downloadData = (): void => {
    const rows: [string, string][] = [
      [t('nationalIdOcr.review.columnField'), t('nationalIdOcr.review.columnValue')],
      [t('nationalIdOcr.field.fullNameAr'), d.fullNameAr],
      [t('nationalIdOcr.field.fullNameEn'), d.fullNameEn],
      [t('nationalIdOcr.field.nationalId'), d.nationalId],
      [t('nationalIdOcr.field.nationalIdExpiry'), d.nationalIdExpiry],
      [
        t('nationalIdOcr.field.maritalStatus'),
        d.maritalStatus === '' ? '' : t(`nationalIdOcr.marital.${d.maritalStatus}`),
      ],
      [t('nationalIdOcr.field.religion'), d.religion],
      [t('nationalIdOcr.field.address'), d.addressLine],
      [t('nationalIdOcr.field.city'), d.city],
      [t('nationalIdOcr.field.birthDate'), derived.birthDate.slice(0, 10)],
      [
        t('nationalIdOcr.field.gender'),
        derived.gender === '' ? '' : t(`nationalIdOcr.gender.${derived.gender}`),
      ],
      [t('nationalIdOcr.field.governorate'), derived.governorate],
    ];
    saveCsv(rows, `${stem}-data.csv`);
  };

  const showMedia =
    meta !== undefined &&
    [meta.cardFront, meta.cardBack, meta.uploadedFront, meta.uploadedBack, meta.portrait].some(
      (v) => v !== undefined,
    );

  const look = (key: keyof NationalIdReviewMeta['confidence']): string =>
    cn(BOX_BASE, d[key] !== initial[key] ? BOX.edited : BOX[confidence[key] ?? 'none']);
  const edited = (key: keyof NationalIdReviewData): boolean => d[key] !== initial[key];
  const toCheck = (Object.keys(confidence) as (keyof NationalIdReviewMeta['confidence'])[]).filter(
    (key) => (confidence[key] === 'low' || confidence[key] === 'medium') && d[key] === initial[key],
  ).length;

  const summary =
    meta === undefined || Object.keys(confidence).length === 0 ? null : toCheck > 0 ? (
      <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertIcon className="h-4 w-4 shrink-0" />
        {t('nationalIdOcr.review.needsCheck', { n: toCheck })}
      </p>
    ) : (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <CheckIcon className="h-4 w-4 shrink-0" />
        {t('nationalIdOcr.review.allClear')}
      </p>
    );

  const fields = (
    <div className="space-y-4">
      <Group icon={<UserIcon className="h-4 w-4" />} title={t('nationalIdOcr.review.groupName')}>
        <div className="space-y-4">
          <Labelled
            id={id('nameAr')}
            label={t('nationalIdOcr.field.fullNameAr')}
            confidence={sure('fullNameAr')}
            edited={edited('fullNameAr')}
          >
            <Field>
              <Input
                id={id('nameAr')}
                value={d.fullNameAr}
                onChange={(e) => set({ fullNameAr: e.target.value })}
                className={cn(look('fullNameAr'), 'text-base font-bold')}
              />
            </Field>
          </Labelled>
          <Labelled
            id={id('nameEn')}
            label={t('nationalIdOcr.field.fullNameEn')}
            edited={edited('fullNameEn')}
          >
            <Field hint={t('nationalIdOcr.field.fullNameEnHint')}>
              <Input
                id={id('nameEn')}
                value={d.fullNameEn}
                onChange={(e) => set({ fullNameEn: e.target.value })}
                dir="ltr"
                className={cn(BOX_BASE, edited('fullNameEn') && BOX.edited)}
              />
            </Field>
          </Labelled>
        </div>
      </Group>

      <Group icon={<BadgeIcon className="h-4 w-4" />} title={t('nationalIdOcr.review.groupCard')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labelled
            id={id('nid')}
            label={t('nationalIdOcr.field.nationalId')}
            confidence={sure('nationalId')}
            edited={edited('nationalId')}
          >
            <Field>
              <Input
                id={id('nid')}
                value={d.nationalId}
                onChange={(e) => set({ nationalId: e.target.value })}
                dir="ltr"
                inputMode="numeric"
                className={cn(
                  look('nationalId'),
                  'font-mono text-base font-semibold tracking-[0.12em]',
                )}
              />
            </Field>
          </Labelled>
          <Labelled
            id={id('expiry')}
            label={t('nationalIdOcr.field.nationalIdExpiry')}
            confidence={sure('nationalIdExpiry')}
            edited={edited('nationalIdExpiry')}
          >
            <Field>
              <Input
                id={id('expiry')}
                type="date"
                value={d.nationalIdExpiry}
                onChange={(e) => set({ nationalIdExpiry: e.target.value })}
                dir="ltr"
                className={look('nationalIdExpiry')}
              />
            </Field>
          </Labelled>
        </div>
      </Group>

      <Group icon={<UsersIcon className="h-4 w-4" />} title={t('nationalIdOcr.review.groupStatus')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labelled
            id={id('marital')}
            label={t('nationalIdOcr.field.maritalStatus')}
            confidence={sure('maritalStatus')}
            edited={edited('maritalStatus')}
          >
            <Field>
              <Select
                id={id('marital')}
                value={d.maritalStatus}
                onChange={(e) =>
                  set({ maritalStatus: e.target.value as NationalIdReviewData['maritalStatus'] })
                }
                className={look('maritalStatus')}
              >
                <option value="">{t('nationalIdOcr.field.unspecified')}</option>
                {MARITAL_STATUSES.map((m) => (
                  <option key={m} value={m}>
                    {t(`nationalIdOcr.marital.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </Labelled>
          <Labelled
            id={id('religion')}
            label={t('nationalIdOcr.field.religion')}
            confidence={sure('religion')}
            edited={edited('religion')}
          >
            <Field>
              <Input
                id={id('religion')}
                value={d.religion}
                onChange={(e) => set({ religion: e.target.value })}
                className={look('religion')}
              />
            </Field>
          </Labelled>
        </div>
      </Group>

      <Group icon={<PinIcon className="h-4 w-4" />} title={t('nationalIdOcr.review.groupAddress')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Labelled
              id={id('address')}
              label={t('nationalIdOcr.field.address')}
              confidence={sure('addressLine')}
              edited={edited('addressLine')}
            >
              <Field>
                <Input
                  id={id('address')}
                  value={d.addressLine}
                  onChange={(e) => set({ addressLine: e.target.value })}
                  className={look('addressLine')}
                />
              </Field>
            </Labelled>
          </div>
          <Labelled
            id={id('city')}
            label={t('nationalIdOcr.field.city')}
            confidence={sure('city')}
            edited={edited('city')}
          >
            <Field>
              <Input
                id={id('city')}
                value={d.city}
                onChange={(e) => set({ city: e.target.value })}
                className={look('city')}
              />
            </Field>
          </Labelled>
        </div>
      </Group>
    </div>
  );

  const derivedPanel = (
    <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 dark:border-brand-900/60 dark:bg-brand-950/30">
      <p className="mb-3 text-xs font-semibold text-brand-700 dark:text-brand-300">
        {t('nationalIdOcr.review.derived')}
      </p>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            {t('nationalIdOcr.field.birthDate')}
          </dt>
          <dd className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">
            {derived.birthDate === '' ? '—' : formatDate(derived.birthDate, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            {t('nationalIdOcr.field.gender')}
          </dt>
          <dd className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">
            {derived.gender === '' ? '—' : t(`nationalIdOcr.gender.${derived.gender}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">
            {t('nationalIdOcr.field.governorate')}
          </dt>
          <dd className="mt-0.5 font-semibold text-slate-800 dark:text-slate-100">
            {derived.governorate === '' ? '—' : derived.governorate}
          </dd>
        </div>
      </dl>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t('nationalIdOcr.review.title')}
      description={t('nationalIdOcr.review.subtitle')}
      size={showMedia ? 'xl' : 'lg'}
      footer={
        <>
          <DownloadButton
            className="me-auto min-h-[40px] px-4"
            label={t('nationalIdOcr.review.downloadData')}
            onClick={downloadData}
          />
          <Button variant="secondary" onClick={onCancel}>
            {t('nationalIdOcr.review.cancel')}
          </Button>
          <Button onClick={confirm}>{t('nationalIdOcr.review.confirm')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {notice !== undefined && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {notice}
          </p>
        )}
        {showMedia && meta !== undefined ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <aside className="space-y-4 rounded-2xl bg-gradient-to-b from-brand-50 to-transparent p-4 lg:sticky lg:top-0 lg:self-start dark:from-brand-950/40">
              <EgycashLogo className="h-7" />
              <CardPanel meta={meta} stem={stem} />
              {meta.portrait !== undefined && (
                <section className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <img
                    src={meta.portrait}
                    alt={t('nationalIdOcr.review.portrait')}
                    className="h-28 w-[5.25rem] shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
                  />
                  <div className="min-w-0 space-y-2">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {t('nationalIdOcr.review.portrait')}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('nationalIdOcr.review.portraitHint')}
                      </p>
                    </div>
                    <DownloadButton
                      label={t('nationalIdOcr.review.downloadPhoto')}
                      onClick={() => {
                        if (meta.portrait !== undefined)
                          saveUrl(meta.portrait, `${stem}-photo.jpg`);
                      }}
                    />
                  </div>
                </section>
              )}
            </aside>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {t('nationalIdOcr.review.extracted')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('nationalIdOcr.review.compareHint')}
                </p>
              </div>
              {summary}
              {fields}
              {derivedPanel}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {summary}
            {fields}
            {derivedPanel}
          </div>
        )}
      </div>
    </Dialog>
  );
};
