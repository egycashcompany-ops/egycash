// The mail pages' filters and the log's restore, as plain functions (2026-10-28, «عايز فلتر وعايز
// Action Buttons»): the address bar (the boards' escaped lists, the search as typed, a status only
// when it is one), the match (bank AND area AND code-or-name AND status, names trimmed, the search
// folded), the dropdowns drawn from the rows read, and which row may be restored with which words.
//
// Every bank, area, code and name below is synthetic.
import { describe, expect, it } from 'vitest';
import { type AtmMailTicketStatus } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  MAIL_STATUS_FILTERS,
  filterMailTickets,
  isMailFiltered,
  isRestorable,
  mailFilterOptions,
  readMailFilters,
  readMailStatus,
  restoreConfirmBody,
  withMailBanks,
  withMailParam,
  withoutMailFilters,
  type MailFilters,
} from './mail-view';

const row = (
  machineCode: string,
  bankName: string,
  area: string,
  status: AtmMailTicketStatus = 'pending',
  machineName = `SYN ATM ${machineCode}`,
) => ({ machineCode, machineName, bankName, area, status });

const ROWS = [
  row('99990001', 'SYN NBE', 'SYN Smouha'),
  row('99990002', 'SYN NBE ', 'SYN Raml', 'accepted'),
  row('99990003', 'SYN CIB', 'SYN Smouha', 'rejected', 'محطة الرمل'),
  row('99990004', 'SYN CIB', ' SYN Miami', 'accepted'),
];

const NONE: MailFilters = { banks: [], areas: [], q: '' };
const codes = (rows: readonly { machineCode: string }[]): string[] =>
  rows.map((one) => one.machineCode);

describe('the address bar', () => {
  it('reads the boards’ escaped bank and area lists, and the search exactly as typed', () => {
    const sp = new URLSearchParams();
    sp.set('banks', 'SYN Bank\\, Ltd,SYN CIB');
    sp.set('areas', 'SYN Smouha');
    sp.set('q', ' 9999 ');
    expect(readMailFilters(sp)).toEqual({
      banks: ['SYN Bank, Ltd', 'SYN CIB'],
      areas: ['SYN Smouha'],
      q: ' 9999 ',
    });
    expect(readMailFilters(new URLSearchParams())).toEqual(NONE);
  });

  it('reads a status only when it is one — anything else is «all»', () => {
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      expect(readMailStatus(new URLSearchParams({ status }))).toBe(status);
    }
    expect(readMailStatus(new URLSearchParams())).toBe('all');
    expect(readMailStatus(new URLSearchParams({ status: 'accpeted' }))).toBe('all');
    expect(MAIL_STATUS_FILTERS).toEqual(['all', 'pending', 'accepted', 'rejected']);
  });

  it('writes the search as typed, drops an empty one and «all», and keeps every other parameter', () => {
    const base = new URLSearchParams('from=2026-10-01&to=2026-10-28');
    const typed = withMailParam(base, 'q', '  ');
    // Not trimmed: `SearchInput` would re-emit a value it was handed back changed.
    expect(typed.get('q')).toBe('  ');
    expect(typed.get('from')).toBe('2026-10-01');
    expect(withMailParam(typed, 'q', '').has('q')).toBe(false);
    expect(withMailParam(base, 'status', 'rejected').get('status')).toBe('rejected');
    expect(
      withMailParam(new URLSearchParams('status=rejected'), 'status', 'all').has('status'),
    ).toBe(false);
  });

  it('resets every filter at once, and never the log’s range', () => {
    const sp = new URLSearchParams(
      'from=2026-10-01&to=2026-10-28&banks=SYN+NBE&areas=SYN+Raml&q=1&status=accepted',
    );
    expect(withoutMailFilters(sp).toString()).toBe('from=2026-10-01&to=2026-10-28');
  });

  it('counts as narrowed by any filter — a search of spaces narrows nothing', () => {
    expect(isMailFiltered(NONE)).toBe(false);
    expect(isMailFiltered({ ...NONE, q: '   ' })).toBe(false);
    expect(isMailFiltered({ ...NONE, q: '1' })).toBe(true);
    expect(isMailFiltered({ ...NONE, banks: ['SYN NBE'] })).toBe(true);
    expect(isMailFiltered({ ...NONE, areas: ['SYN Raml'] })).toBe(true);
    expect(isMailFiltered(NONE, 'rejected')).toBe(true);
    expect(isMailFiltered(NONE, 'all')).toBe(false);
  });
});

describe('filterMailTickets — what the table keeps', () => {
  it('keeps every row while nothing narrows it', () => {
    expect(filterMailTickets(ROWS, NONE)).toEqual(ROWS);
  });

  it('matches a bank or an area by its name trimmed — a stored trailing space is the same name', () => {
    expect(codes(filterMailTickets(ROWS, { ...NONE, banks: ['SYN NBE'] }))).toEqual([
      '99990001',
      '99990002',
    ]);
    expect(codes(filterMailTickets(ROWS, { ...NONE, areas: ['SYN Miami'] }))).toEqual(['99990004']);
  });

  it('ANDs the filters together, and ORs the choices inside one', () => {
    expect(
      codes(filterMailTickets(ROWS, { ...NONE, banks: ['SYN CIB'], areas: ['SYN Smouha'] })),
    ).toEqual(['99990003']);
    expect(codes(filterMailTickets(ROWS, { ...NONE, areas: ['SYN Smouha', 'SYN Raml'] }))).toEqual([
      '99990001',
      '99990002',
      '99990003',
    ]);
  });

  it('searches the code or the name, trimmed and folded — Arabic spellings and digits alike', () => {
    expect(codes(filterMailTickets(ROWS, { ...NONE, q: ' 0002 ' }))).toEqual(['99990002']);
    expect(codes(filterMailTickets(ROWS, { ...NONE, q: 'syn atm 9999000' }))).toEqual([
      '99990001',
      '99990002',
      '99990004',
    ]);
    // «محطه» finds «محطة»; «٩٩٩٩٠٠٠٣» is the same code typed on an Arabic keyboard.
    expect(codes(filterMailTickets(ROWS, { ...NONE, q: 'محطه' }))).toEqual(['99990003']);
    expect(codes(filterMailTickets(ROWS, { ...NONE, q: '٩٩٩٩٠٠٠٣' }))).toEqual(['99990003']);
    expect(filterMailTickets(ROWS, { ...NONE, q: 'nothing like it' })).toEqual([]);
  });

  it('narrows by status on the log only when one is chosen', () => {
    expect(codes(filterMailTickets(ROWS, NONE, 'accepted'))).toEqual(['99990002', '99990004']);
    expect(codes(filterMailTickets(ROWS, { ...NONE, banks: ['SYN CIB'] }, 'accepted'))).toEqual([
      '99990004',
    ]);
    expect(filterMailTickets(ROWS, NONE, 'all')).toEqual(ROWS);
  });
});

describe('mailFilterOptions — the dropdowns, from the rows read', () => {
  const values = (options: readonly { value: string }[]): string[] =>
    options.map((option) => option.value);

  it('offers each bank and area once, trimmed, blank ones dropped, in order', () => {
    const { bankOptions, areaOptions } = mailFilterOptions(
      [...ROWS, row('99990005', '  ', '')],
      NONE,
    );
    expect(values(bankOptions)).toEqual(['SYN CIB', 'SYN NBE']);
    expect(values(areaOptions)).toEqual(['SYN Miami', 'SYN Raml', 'SYN Smouha']);
    expect(bankOptions[0]).toEqual({ value: 'SYN CIB', label: 'SYN CIB' });
  });

  it('lists only the chosen banks’ areas — the bank list itself stays whole', () => {
    const { bankOptions, areaOptions } = mailFilterOptions(ROWS, { banks: ['SYN NBE'], areas: [] });
    expect(values(bankOptions)).toEqual(['SYN CIB', 'SYN NBE']);
    expect(values(areaOptions)).toEqual(['SYN Raml', 'SYN Smouha']);
  });

  it('keeps a choice the rows no longer hold listed after them, so it can be unticked', () => {
    const { bankOptions, areaOptions } = mailFilterOptions(ROWS, {
      banks: ['SYN AAIB'],
      areas: ['SYN Raml'],
    });
    expect(values(bankOptions)).toEqual(['SYN CIB', 'SYN NBE', 'SYN AAIB']);
    // No row is the chosen bank's, so only the chosen area is offered — and it stays.
    expect(values(areaOptions)).toEqual(['SYN Raml']);
  });
});

describe('withMailBanks — a bank change, and the areas it leaves behind', () => {
  const bar = (query: string): URLSearchParams => new URLSearchParams(query);

  it('drops a chosen area the new banks’ rows do not hold — the boards’ cascade', () => {
    // «SYN Raml» is an NBE area only: switching to CIB cannot leave the table asking for CIB there.
    const next = withMailBanks(bar('banks=SYN+NBE&areas=SYN+Raml&q=1'), ['SYN CIB'], ROWS);
    expect(next.get('banks')).toBe('SYN CIB');
    expect(next.has('areas')).toBe(false);
    expect(next.get('q')).toBe('1');
  });

  it('keeps the chosen areas the new banks still hold, matched by the name trimmed', () => {
    const next = withMailBanks(bar('areas=SYN+Smouha,SYN+Raml,SYN+Miami'), ['SYN CIB'], ROWS);
    // CIB holds Smouha and « SYN Miami» (stored with a space); Raml is NBE's alone.
    expect(next.get('areas')).toBe('SYN Smouha,SYN Miami');
  });

  it('clearing the banks keeps every area some row holds', () => {
    const next = withMailBanks(bar('banks=SYN+CIB&areas=SYN+Smouha,SYN+Raml'), [], ROWS);
    expect(next.has('banks')).toBe(false);
    expect(next.get('areas')).toBe('SYN Smouha,SYN Raml');
  });

  it('drops nothing while the rows are still being read, or when no area is chosen', () => {
    expect(withMailBanks(bar('areas=SYN+Raml'), ['SYN CIB'], undefined).get('areas')).toBe(
      'SYN Raml',
    );
    const banksOnly = withMailBanks(bar('from=2026-10-01'), ['SYN CIB', 'SYN NBE'], ROWS);
    expect(banksOnly.toString()).toBe('from=2026-10-01&banks=SYN+CIB%2CSYN+NBE');
  });
});

describe('the log’s restore', () => {
  it('is offered on a decided mail only', () => {
    expect(isRestorable({ status: 'accepted' })).toBe(true);
    expect(isRestorable({ status: 'rejected' })).toBe(true);
    expect(isRestorable({ status: 'pending' })).toBe(false);
  });

  it('warns about the maintenance only for an accepted mail, naming the machine', () => {
    for (const locale of ['ar', 'en'] as const) {
      const t = (key: string, params?: Record<string, string | number>): string =>
        translate(locale, key, params);
      const accepted = restoreConfirmBody(t, { status: 'accepted', machineCode: '99990002' });
      const rejected = restoreConfirmBody(t, { status: 'rejected', machineCode: '99990003' });
      expect(accepted).toBe(t('atm.mail.restoreBodyAccepted', { code: '99990002' }));
      expect(rejected).toBe(t('atm.mail.restoreBodyRejected', { code: '99990003' }));
      expect(accepted).toContain('99990002');
      expect(rejected).toContain('99990003');
      expect(accepted).not.toBe(t('atm.mail.restoreBodyRejected', { code: '99990002' }));
    }
    const ar = (key: string, params?: Record<string, string | number>): string =>
      translate('ar', key, params);
    expect(restoreConfirmBody(ar, { status: 'accepted', machineCode: '99990002' })).toContain(
      'الصيانة',
    );
    expect(restoreConfirmBody(ar, { status: 'rejected', machineCode: '99990003' })).not.toContain(
      'الصيانة',
    );
  });
});
