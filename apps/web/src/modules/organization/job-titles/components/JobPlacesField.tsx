// «مكانها في الهيكل التنظيمي» on the job form (P-ORG-3 §2.3, ADR-038): where the job is found — a
// department, or one of its sections; several allowed. It describes the structure and blocks nothing.
//
// The chart reads and writes the very same rows, so the department and section choices come from the
// chart's own read: only departments and sections that can take a new place are offered. A place the
// job already has under a stopped section stays listed, tagged «موقوف», and is sent back as it is.
import { useMemo, useState } from 'react';
import { type JobTitlePlaceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Field } from '../../../../shared/ui/form';
import { SearchableSelect } from '../../../../shared/ui/SearchableSelect';
import { localized } from '../../../../shared/lib/format';
import { useOrgChart } from '../../org-chart/org-chart-queries';

export interface PlaceRow {
  departmentCatalogId: string;
  sectionCatalogId: string | null;
  departmentName: { ar: string; en: string };
  sectionName: { ar: string; en: string } | null;
  shown: boolean;
}

/** The empty value of the section picker: «directly under the department». */
const DIRECT = '__direct__';

const sameRow = (
  a: PlaceRow,
  b: { departmentCatalogId: string; sectionCatalogId: string | null },
): boolean =>
  a.departmentCatalogId.toLowerCase() === b.departmentCatalogId.toLowerCase() &&
  (a.sectionCatalogId?.toLowerCase() ?? null) === (b.sectionCatalogId?.toLowerCase() ?? null);

export const placeLabel = (row: PlaceRow, locale: Locale, direct: string): string =>
  `${localized(row.departmentName, locale)} › ${row.sectionName === null ? direct : localized(row.sectionName, locale)}`;

/** A job's stored place as a row of this field (and of the detail page's card). */
export const placeRowOf = (place: JobTitlePlaceDto): PlaceRow => ({
  departmentCatalogId: place.department.departmentCatalogId,
  sectionCatalogId: place.section?.sectionCatalogId ?? null,
  departmentName: place.department.name,
  sectionName: place.section?.name ?? null,
  shown: place.shown,
});

const byName =
  (locale: Locale) =>
  (a: { name: { ar: string; en: string } }, b: { name: { ar: string; en: string } }): number =>
    localized(a.name, locale).localeCompare(localized(b.name, locale), locale);

/** The job's places, one row each — the form's (with ✕) and the detail page's (read-only) alike. */
export const PlaceRows = ({
  rows,
  locale,
  onRemove,
}: {
  rows: readonly PlaceRow[];
  locale: Locale;
  onRemove?: (row: PlaceRow) => void;
}): JSX.Element => {
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('organization.jobTitles.places.none')}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={`${row.departmentCatalogId}|${row.sectionCatalogId ?? ''}`}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1 text-sm dark:border-slate-700"
        >
          <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
            {placeLabel(row, locale, t('organization.chart.direct'))}
          </span>
          {!row.shown && <Badge tone="warning">{t('organization.jobTitles.places.stopped')}</Badge>}
          {onRemove !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('common.remove')}
              title={t('common.remove')}
              onClick={() => onRemove(row)}
            >
              ✕
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};

export const JobPlacesField = ({
  value,
  onChange,
  locale,
}: {
  value: readonly PlaceRow[];
  onChange: (next: PlaceRow[]) => void;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const chart = useOrgChart();
  const [departmentId, setDepartmentId] = useState('');
  const [sectionId, setSectionId] = useState(DIRECT);

  const departments = useMemo(
    () =>
      (chart.data?.departments ?? [])
        .filter((d) => d.editable && d.departmentCatalogId !== null)
        .sort(byName(locale)),
    [chart.data, locale],
  );
  const department = departments.find((d) => d.departmentCatalogId === departmentId);
  const sections = (department?.sections ?? [])
    .filter((s) => s.editable && s.sectionCatalogId !== null)
    .sort(byName(locale));

  const add = (): void => {
    if (department === undefined || department.departmentCatalogId === null) return;
    const section =
      sectionId === DIRECT ? undefined : sections.find((s) => s.sectionCatalogId === sectionId);
    const row: PlaceRow = {
      departmentCatalogId: department.departmentCatalogId,
      sectionCatalogId: section?.sectionCatalogId ?? null,
      departmentName: department.name,
      sectionName: section?.name ?? null,
      shown: true,
    };
    // Adding a place already listed does nothing (§2.3).
    if (!value.some((existing) => sameRow(existing, row))) onChange([...value, row]);
    setSectionId(DIRECT);
  };

  return (
    <Card>
      <CardHeader
        title={t('organization.jobTitles.places.title')}
        description={t('organization.jobTitles.places.hint')}
      />
      <CardBody className="space-y-4">
        <PlaceRows
          rows={value}
          locale={locale}
          onRemove={(row) => onChange(value.filter((existing) => !sameRow(existing, row)))}
        />

        {chart.isError ? (
          // Without the chart there is nothing true to offer; an empty picker would read as "no departments".
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t('organization.jobTitles.places.optionsFailed')}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label={t('organization.field.department')}>
              <SearchableSelect
                value={departmentId}
                onChange={(next) => {
                  setDepartmentId(next);
                  setSectionId(DIRECT);
                }}
                loading={chart.isLoading}
                options={departments.map((d) => ({
                  value: d.departmentCatalogId ?? '',
                  label: localized(d.name, locale),
                }))}
              />
            </Field>
            <Field label={t('organization.field.section')}>
              <SearchableSelect
                value={sectionId}
                onChange={setSectionId}
                disabled={department === undefined}
                options={[
                  { value: DIRECT, label: t('organization.chart.direct') },
                  ...sections.map((s) => ({
                    value: s.sectionCatalogId ?? '',
                    label: localized(s.name, locale),
                  })),
                ]}
              />
            </Field>
            <Button variant="secondary" disabled={department === undefined} onClick={add}>
              {t('organization.jobTitles.places.add')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
