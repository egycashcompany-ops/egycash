// The insurance notices (الإخطارات): where each answer lands on the insurer's page, and the rules
// that decide what is written there.
import { describe, expect, it } from 'vitest';
import { dateParts, noticePageMarkup, plateParts, slotStyle } from './notice-render';
import { NOTICE_PAGE, NOTICE_TEMPLATES, noticeTemplate } from './notice-templates';
import { autofillValues, NOTICE_COMPANY_NAME } from './notice-autofill';

const misr = noticeTemplate('misrInsurance');
const delta = noticeTemplate('deltaInsurance');

describe('the forms', () => {
  it('are the two the owner sent — مصر للتأمين (two pages) and الدلتا (one)', () => {
    expect(NOTICE_TEMPLATES.map((template) => template.key)).toEqual([
      'misrInsurance',
      'deltaInsurance',
    ]);
    expect(misr?.pages).toHaveLength(2);
    expect(delta?.pages).toHaveLength(1);
  });

  it('put every box on the page, the right way round, on a page the form has', () => {
    for (const template of NOTICE_TEMPLATES) {
      const keys = new Set<string>();
      for (const field of template.sections.flatMap((section) => section.fields)) {
        expect(keys.has(field.key), `${template.key}.${field.key} is named once`).toBe(false);
        keys.add(field.key);
        expect(field.page).toBeLessThan(template.pages.length);
        const slots = [
          ...(field.slot === undefined ? [] : [field.slot]),
          ...(field.parts ?? []),
          ...(field.lines ?? []),
        ];
        expect(slots.length, `${template.key}.${field.key} has somewhere to go`).toBeGreaterThan(0);
        for (const slot of slots) {
          expect(slot.left, `${field.key}`).toBeLessThan(slot.right);
          expect(slot.left).toBeGreaterThanOrEqual(0);
          expect(slot.right).toBeLessThanOrEqual(NOTICE_PAGE.width);
          expect(slot.y).toBeGreaterThan(0);
          expect(slot.y).toBeLessThan(NOTICE_PAGE.height);
        }
      }
      for (const check of template.checks) {
        expect(keys.has(check.key)).toBe(false);
        expect(
          template.sections.some((section) => section.title === check.afterSection),
          `${check.key} is asked under a section the form has`,
        ).toBe(true);
      }
    }
  });
});

describe('writing an answer onto the page', () => {
  it('places a box by percent of the page, at the middle of its line', () => {
    expect(slotStyle({ right: 744, left: 372, y: 526.5 })).toBe(
      'right:0.000%;width:50.000%;top:50.000%',
    );
  });

  it('leaves an empty box empty — nothing is required', () => {
    if (misr === undefined) throw new Error('no misr');
    expect(noticePageMarkup(misr, 0, { values: {}, checks: {} })).toBe('');
    expect(noticePageMarkup(misr, 0, { values: { driverName: '   ' }, checks: {} })).toBe('');
  });

  it('escapes what it writes', () => {
    if (misr === undefined) throw new Error('no misr');
    const html = noticePageMarkup(misr, 0, { values: { driverName: '<b>x</b>' }, checks: {} });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('writes an answer on its own page only', () => {
    if (misr === undefined) throw new Error('no misr');
    const answers = { values: { driverName: 'حسين', tpName: 'أحمد' }, checks: {} };
    expect(noticePageMarkup(misr, 0, answers)).toContain('حسين');
    expect(noticePageMarkup(misr, 0, answers)).not.toContain('أحمد');
    expect(noticePageMarkup(misr, 1, answers)).toContain('أحمد');
  });

  it('marks the box being typed in', () => {
    if (misr === undefined) throw new Error('no misr');
    const html = noticePageMarkup(
      misr,
      0,
      { values: { driverName: 'حسين' }, checks: {} },
      'driverName',
    );
    expect(html).toContain('nt-hl');
  });

  it('draws a tick in the chosen circle only', () => {
    if (misr === undefined) throw new Error('no misr');
    const html = noticePageMarkup(misr, 0, { values: {}, checks: { cause: ['تصادم'] } });
    expect(html.match(/class="nt-c"/gu)).toHaveLength(1);
    expect(html).toContain('<svg');
  });
});

describe('dates and plates', () => {
  it('splits a date into the form’s day, month and year boxes, however it was written', () => {
    expect(dateParts('2026-09-28')).toEqual(['28', '09', '2026']);
    expect(dateParts('28/9/2026')).toEqual(['28', '09', '2026']);
    expect(dateParts('2026/9/8')).toEqual(['08', '09', '2026']);
    // The Delta form prints «٢٠٢» and leaves one digit.
    expect(dateParts('2026-09-29', true)).toEqual(['29', '09', '6']);
    // Anything else is written as typed, never refused.
    expect(dateParts('أمس')).toEqual(['أمس', '', '']);
  });

  it('puts a plate’s letters and digits on the two sides of the printed slash', () => {
    expect(plateParts('أ ب ج 1234')).toEqual(['أ ب ج', '1234']);
    expect(plateParts('ن ص ط ٣٨٤٢')).toEqual(['ن ص ط', '٣٨٤٢']);
  });
});

describe('«املأ من النظام»', () => {
  it('fills only the boxes it has a fact for', () => {
    if (misr === undefined) throw new Error('no misr');
    const values = autofillValues(misr, {
      company: true,
      vehicle: {
        plateNumber: 'ن ص ط 3842',
        chassisNumber: 'CH-1',
        motorNumber: 'MO-1',
      } as never,
      vehicleTypeName: 'ميتسوبيشي لانسر',
    });
    expect(values).toEqual({
      insuredName: NOTICE_COMPANY_NAME,
      plateNo: 'ن ص ط 3842',
      chassisNo: 'CH-1',
      motorNo: 'MO-1',
      model: 'ميتسوبيشي لانسر',
    });
  });

  it('writes a date the way each box reads it', () => {
    if (misr === undefined || delta === undefined) throw new Error('no forms');
    const accident = { occurredAt: '2026-09-28T00:00:00.000Z', statement: 'تصادم خلفي' } as never;
    // Misr's «تاريخ الحادث» is three boxes, fed by a date input; the Delta's is one plain box.
    expect(autofillValues(misr, { accident })['accidentDate']).toBe('2026-09-28');
    expect(autofillValues(delta, { accident })['accidentDate']).toBe('2026/09/28');
    expect(autofillValues(misr, { accident })['how']).toBe('تصادم خلفي');
  });
});
