// Who the receipt names: the identity line «بطاقة رقم قومي … صادرة من قسم … – …» is read from HR
// through the directory, and the section's and department's NAMES from the organization — never
// by importing HR. A person HR does not know leaves every line blank for the pen.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchDirectoryEmployees: vi.fn(),
  getDirectoryEmployee: vi.fn(),
  getDirectoryIdentityFacts: vi.fn(),
  jobTitles: vi.fn(),
  departments: vi.fn(),
  sections: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  searchDirectoryEmployees: mocks.searchDirectoryEmployees,
  getDirectoryEmployee: mocks.getDirectoryEmployee,
  getDirectoryIdentityFacts: mocks.getDirectoryIdentityFacts,
}));
vi.mock('../../../platform/organization', () => ({
  jobTitleRepository: { findByIdsSystem: mocks.jobTitles },
  departmentRepository: { findByIdsSystem: mocks.departments },
  sectionRepository: { findByIdsSystem: mocks.sections },
}));

const { readReceiptHolder } = await import('./receipt-holder');

const EMPLOYEE = '000000000000000000000a01';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchDirectoryEmployees.mockResolvedValue({
    items: [
      {
        employeeId: EMPLOYEE,
        code: '0100026',
        fullNameAr: 'بسام هشام رضوان محمد حسنين',
        status: 'active',
        departmentId: 'dep-1',
        jobTitleId: 'job-1',
      },
    ],
  });
  mocks.getDirectoryIdentityFacts.mockResolvedValue({
    nationalId: '29801011234567',
    sectionId: 'sec-1',
  });
  mocks.jobTitles.mockResolvedValue([
    { name: { ar: 'أخصائي تسويات', en: 'Settlements specialist' } },
  ]);
  mocks.departments.mockResolvedValue([{ name: { ar: 'الإدارة المالية', en: 'Finance' } }]);
  mocks.sections.mockResolvedValue([{ name: { ar: 'التسويات', en: 'Settlements' } }]);
});

describe('the receipt’s holder', () => {
  it('reads the identity line from HR and the organization', async () => {
    const holder = await readReceiptHolder(EMPLOYEE);
    expect(holder.employeeName).toBe('بسام هشام رضوان محمد حسنين');
    expect(holder.jobTitle).toEqual({ ar: 'أخصائي تسويات', en: 'Settlements specialist' });
    expect(holder.nationalId).toBe('29801011234567');
    expect(holder.section).toEqual({ ar: 'التسويات', en: 'Settlements' });
    expect(holder.department).toEqual({ ar: 'الإدارة المالية', en: 'Finance' });
    expect(mocks.getDirectoryIdentityFacts).toHaveBeenCalledWith(EMPLOYEE);
    expect(mocks.departments).toHaveBeenCalledWith(['dep-1']);
    expect(mocks.sections).toHaveBeenCalledWith(['sec-1']);
  });

  it('an employee filed under no section has none — and nothing is looked up for it', async () => {
    mocks.getDirectoryIdentityFacts.mockResolvedValue({ nationalId: null, sectionId: null });
    const holder = await readReceiptHolder(EMPLOYEE);
    expect(holder.section).toBeNull();
    expect(holder.nationalId).toBeNull();
    expect(mocks.sections).not.toHaveBeenCalled();
  });

  it('a person HR does not know leaves every line blank for the pen', async () => {
    mocks.searchDirectoryEmployees.mockResolvedValue({ items: [] });
    mocks.getDirectoryEmployee.mockResolvedValue(null);
    mocks.getDirectoryIdentityFacts.mockResolvedValue(null);
    const holder = await readReceiptHolder(EMPLOYEE);
    expect(holder).toEqual({
      employee: null,
      employeeCode: null,
      employeeName: null,
      jobTitle: null,
      nationalId: null,
      section: null,
      department: null,
    });
  });
});
