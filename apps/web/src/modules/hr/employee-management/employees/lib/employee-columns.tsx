// The registry's columns, as a pure function of the translator and locale — so the ORDER, which
// is what this screen's readers actually asked for, can be pinned by a test without mounting the
// page.
//
// Identity first (code, name), then where the person is (site → department → section → job), then
// when they came, and status LAST — the reader asked for it at the end, where the coloured badge
// closes the row rather than opening it. Origin is gone: whether somebody was hired through
// recruitment or registered directly is a fact about the hiring process, not about the person,
// and it earned its width on no reader's screen.
import { type ReactNode } from 'react';
import { type EmployeeDto, type EmployeePlacementUnitDto, type Locale } from '@ecms/contracts';
import { type Column } from '../../../../../shared/ui/DataTable';
import { formatDate } from '../../../../../shared/lib/format';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A unit's name in the reader's language; a dash when the reference did not resolve. */
const unitName = (unit: EmployeePlacementUnitDto | null, locale: Locale): ReactNode =>
  unit === null ? <span className="text-slate-400">—</span> : unit.name[locale];

export const EMPLOYEE_COLUMN_ORDER = [
  'code',
  'name',
  'branch',
  'department',
  'section',
  'jobTitle',
  'hiredAt',
  'status',
] as const;

export const employeeColumns = (t: Translate, locale: Locale): Column<EmployeeDto>[] => [
  {
    key: 'code',
    header: t('employees.columns.code'),
    sortable: true,
    render: (e) => (
      <span className="font-mono text-xs" dir="ltr">
        {e.code}
      </span>
    ),
  },
  { key: 'name', header: t('employees.columns.name'), render: (e) => <span>{e.personal.fullNameAr}</span> },
  { key: 'branch', header: t('employees.columns.branch'), render: (e) => unitName(e.placement.branch, locale) },
  {
    key: 'department',
    header: t('employees.columns.department'),
    render: (e) => unitName(e.placement.department, locale),
  },
  { key: 'section', header: t('employees.columns.section'), render: (e) => unitName(e.placement.section, locale) },
  { key: 'jobTitle', header: t('employees.columns.jobTitle'), render: (e) => unitName(e.placement.jobTitle, locale) },
  {
    key: 'hiredAt',
    header: t('employees.columns.hired'),
    sortable: true,
    render: (e) => formatDate(e.hiredAt, locale),
  },
  {
    key: 'status',
    header: t('employees.columns.status'),
    render: (e) => <EmployeeStatusBadge status={e.status} />,
  },
];
