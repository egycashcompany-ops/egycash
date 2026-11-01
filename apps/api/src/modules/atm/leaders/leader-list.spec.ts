// The leader list's pure rules: which department is the ATM department by its NAME — the legacy's
// own rule (contad_app.js:1110-1112, «الصراف الالى») — however its name is spelled, and the names
// the pickers offer: working employees only, each once, in Arabic order.
import { describe, expect, it } from 'vitest';
import { type DirectoryEmployee } from '../../../platform/directory';
import { isAtmDepartmentName, toLeaderOptions } from './leader-list';

const named = (ar: string, en = ''): { ar: string; en: string } => ({ ar, en });

describe('isAtmDepartmentName', () => {
  it.each([
    ['الصراف الآلي'],
    ['الصراف الالى'],
    ['الصراف الالي'],
    ['الصَّرَّاف الآلِي'],
    ['إدارة الصراف الآلي'],
    ['قسم الصرافات الآلية'],
    ['صراف آلي'],
    ['الصراف  الآلى'],
  ])('finds «%s»', (ar) => {
    expect(isAtmDepartmentName(named(ar))).toBe(true);
  });

  it.each([['ATM'], ['ATM Operations'], ['ATMs'], ['Automated Teller Machines'], ['atm team']])(
    'finds the English «%s»',
    (en) => {
      expect(isAtmDepartmentName(named('قسم', en))).toBe(true);
    },
  );

  it.each([
    [named('نقل الأموال', 'Cash Transfer')],
    [named('الصرافة', 'Exchange')],
    [named('الخزينة', 'Treatment Center')],
    [named('الصيانة', 'Maintenance')],
    [named('صراف', 'Teller')],
  ])('leaves out %j', (name) => {
    expect(isAtmDepartmentName(name)).toBe(false);
  });
});

const employee = (overrides: Partial<DirectoryEmployee>): DirectoryEmployee => ({
  employeeId: '650000000000000000000001',
  code: '0100001',
  fullNameAr: 'أحمد محمد',
  status: 'active',
  branchId: null,
  departmentId: null,
  phone: null,
  governorate: null,
  hiredAt: null,
  address: null,
  ...overrides,
});

describe('toLeaderOptions', () => {
  it('offers working employees only, each once, in Arabic order with the code as the tie-break', () => {
    const options = toLeaderOptions([
      employee({ employeeId: 'e3', code: '0300', fullNameAr: 'محمود علي' }),
      employee({ employeeId: 'e1', code: '0200', fullNameAr: 'أحمد سعيد' }),
      employee({ employeeId: 'e2', code: '0100', fullNameAr: 'أحمد سعيد' }),
      employee({ employeeId: 'e1', code: '0200', fullNameAr: 'أحمد سعيد' }),
      employee({ employeeId: 'e4', code: '0400', fullNameAr: 'بكر خالد', status: 'exited' }),
      employee({ employeeId: 'e5', code: '0500', fullNameAr: 'تامر حسن', status: 'onLeave' }),
    ]);
    expect(options).toEqual([
      { employeeId: 'e2', name: 'أحمد سعيد', code: '0100' },
      { employeeId: 'e1', name: 'أحمد سعيد', code: '0200' },
      { employeeId: 'e5', name: 'تامر حسن', code: '0500' },
      { employeeId: 'e3', name: 'محمود علي', code: '0300' },
    ]);
  });

  it('offers nobody for nobody', () => {
    expect(toLeaderOptions([])).toEqual([]);
  });
});
