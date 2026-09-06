// The column order is the request, so it is the assertion.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { type EmployeeDto } from '@ecms/contracts';
import { EMPLOYEE_COLUMN_ORDER, employeeColumns } from './employee-columns';

const t = (key: string): string => key;
const columns = employeeColumns(t, 'ar');

const employee = (placement: Partial<EmployeeDto['placement']> = {}): EmployeeDto =>
  ({
    id: 'e1',
    code: '0100004',
    status: 'active',
    personal: { fullNameAr: 'أحمد محمد' },
    hiredAt: '2019-03-01T00:00:00.000Z',
    placement: {
      branch: { id: 'b', code: '010', name: { ar: 'المهندسين', en: 'Mohandessin' } },
      department: { id: 'd', code: 'DEP-0001', name: { ar: 'العمليات', en: 'Operations' } },
      section: null,
      jobTitle: { id: 'j', code: 'JOB-0001', name: { ar: 'سائق', en: 'Driver' } },
      ...placement,
    },
  }) as unknown as EmployeeDto;

describe('the employees list columns', () => {
  it('are, in order: code, name, site, department, section, job title, hire date, status', () => {
    expect(columns.map((c) => c.key)).toEqual([...EMPLOYEE_COLUMN_ORDER]);
  });

  it('no longer carry the hiring origin', () => {
    expect(columns.map((c) => c.key)).not.toContain('origin');
  });

  it('name a unit in the reader’s language', () => {
    const branch = columns.find((c) => c.key === 'branch');
    expect(renderToStaticMarkup(<>{branch?.render(employee(), 0)}</>)).toContain('المهندسين');
    const en = employeeColumns(t, 'en').find((c) => c.key === 'branch');
    expect(renderToStaticMarkup(<>{en?.render(employee(), 0)}</>)).toContain('Mohandessin');
  });

  /** 7% of the workforce has no section; the cell says so quietly rather than breaking. */
  it('show a dash for an unresolved or absent unit', () => {
    const section = columns.find((c) => c.key === 'section');
    expect(renderToStaticMarkup(<>{section?.render(employee(), 0)}</>)).toContain('—');
  });

  it('keep code and hire date sortable, and nothing derived sortable', () => {
    const sortable = columns.filter((c) => c.sortable === true).map((c) => c.key);
    expect(sortable).toEqual(['code', 'hiredAt']);
  });
});
