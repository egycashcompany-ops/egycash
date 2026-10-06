import { describe, expect, it } from 'vitest';
import { type FleetNoticeSettingsDto } from '@ecms/contracts';
import { noticeTemplate } from './notice-templates';
import {
  handTypedKeys,
  noticeMeta,
  parseNoticeDay,
  startingValues,
  todayFor,
  valueFor,
  withLinked,
} from './notice-setup';

const misr = noticeTemplate('misrInsurance')!;
const fields = new Map(misr.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
const settings: FleetNoticeSettingsDto = {
  template: 'misrInsurance',
  defaults: {
    insuredName: { mode: 'fixed', value: 'شركة إيجي كاش' },
    reportDate: { mode: 'today', value: '' },
    place: { mode: 'empty', value: '' },
  },
  links: [
    { name: 'تاريخ الحادث', keys: ['accidentDate', 'date'] },
    { name: 'تاريخ اليوم', keys: ['reportDate', 'signedAt'] },
  ],
  numberField: null,
  dateField: null,
  version: 0,
  updatedAt: null,
};

describe('a form’s set-up on a new notice', () => {
  it('writes a day the way each box holds one', () => {
    expect(valueFor(fields.get('accidentDate'), '2026/10/5')).toBe('2026-10-05');
    expect(valueFor(fields.get('reportDate'), '2026-10-05')).toBe('2026/10/05');
    expect(valueFor(fields.get('insuredName'), 'إيجي كاش')).toBe('إيجي كاش');
    expect(todayFor(fields.get('signedAt'), new Date(2026, 9, 6))).toBe('2026-10-06');
  });

  it('starts with the fixed words, today, and today again in the box that shares it', () => {
    const values = startingValues(misr, settings, new Date(2026, 9, 6));
    expect(values).toEqual({
      insuredName: 'شركة إيجي كاش',
      reportDate: '2026/10/06',
      signedAt: '2026-10-06',
    });
  });

  it('writes one typed answer into every box of its group, and leaves the rest', () => {
    const next = withLinked(misr, settings, { place: 'الطريق' }, 'accidentDate', '2026-10-05');
    expect(next).toEqual({ place: 'الطريق', accidentDate: '2026-10-05', date: '2026-10-05' });
    expect(withLinked(misr, settings, {}, 'place', 'x')).toEqual({ place: 'x' });
  });

  it('names the boxes the system must not fill', () => {
    expect([...handTypedKeys(settings)]).toEqual(['place']);
  });
});

describe('the notice’s number and date, read off its boxes', () => {
  it('takes the header boxes until the set-up chooses others', () => {
    expect(noticeMeta(misr, undefined, { accidentNo: ' 1452 ', reportDate: '5/10/2026' })).toEqual({
      noticeNumber: '1452',
      noticeDate: '2026-10-05',
    });
    expect(
      noticeMeta(
        misr,
        { numberField: 'policyNo', dateField: 'accidentDate' },
        {
          accidentNo: '1452',
          policyNo: 'P-9',
          accidentDate: '2026-09-30',
        },
      ),
    ).toEqual({ noticeNumber: 'P-9', noticeDate: '2026-09-30' });
    expect(noticeMeta(misr, undefined, {})).toEqual({ noticeNumber: null, noticeDate: null });
  });

  it('reads a day however it was written, and nothing that is no day', () => {
    expect(parseNoticeDay('2026/10/05')).toBe('2026-10-05');
    expect(parseNoticeDay('٥/١٠/٢٠٢٦')).toBe('2026-10-05');
    expect(parseNoticeDay('31/02/2026')).toBeNull();
    expect(parseNoticeDay('أمس')).toBeNull();
  });
});
