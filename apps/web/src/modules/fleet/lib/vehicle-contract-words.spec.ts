// «عقود توريد السيارات» — how the screens count and say things, proven against the dictionary: every
// counted form in formal Arabic, the alarm's phrases with their figure set apart, the deliveries'
// ordinals, the unnamed contract's name, a file's size, and which refusals the screens word.
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import {
  REFUSAL_KEY,
  phraseText,
  vehicleContractRefusalOf,
  vehicleContractWords,
  type VehicleContractNoun,
} from './vehicle-contract-words';

const ar = vehicleContractWords((key, params) => translate('ar', key, params), 'ar');
const en = vehicleContractWords((key, params) => translate('en', key, params), 'en');

describe('counting, in five Arabic forms', () => {
  it.each<[VehicleContractNoun, number, string]>([
    ['contract', 1, 'عقد واحد'],
    ['contract', 2, 'عقدان'],
    ['contract', 5, '5 عقود'],
    ['contract', 11, '11 عقدًا'],
    ['contract', 100, '100 عقد'],
    ['car', 1, 'سيارة واحدة'],
    ['car', 2, 'سيارتان'],
    ['car', 7, '7 سيارات'],
    ['car', 33, '33 سيارة'],
    ['file', 2, 'ملفان'],
    ['file', 8, '8 ملفات'],
    ['file', 12, '12 ملفًا'],
    ['line', 1, 'بند واحد'],
    ['line', 2, 'بندان'],
    ['delivery', 3, '3 استلامات'],
    ['delivery', 1_200, '1,200 استلام'],
  ])('%s × %d → %s', (noun, n, text) => {
    expect(ar.count(noun, n)).toBe(text);
  });

  it('the unit alone, after a figure the screen draws', () => {
    expect(ar.unit('car', 32)).toBe('سيارة');
    expect(ar.unit('car', 3)).toBe('سيارات');
    expect(ar.unit('contract', 5)).toBe('عقود');
    expect(en.unit('car', 1)).toBe('car');
    expect(en.unit('car', 32)).toBe('cars');
  });

  it('«في بند واحد», «في بندين», «في 3 بنود»', () => {
    expect([1, 2, 3, 11].map(ar.inLines)).toEqual([
      'في بند واحد',
      'في بندين',
      'في 3 بنود',
      'في 11 بندًا',
    ]);
  });

  it('English says one and many', () => {
    expect(en.count('contract', 1)).toBe('One contract');
    expect(en.count('contract', 5)).toBe('5 contracts');
  });
});

describe('the alarm phrases keep their figure apart', () => {
  it('days ahead, today and overdue', () => {
    expect(ar.days(0)).toEqual({ before: 'اليوم', figure: null, after: '' });
    expect(ar.days(1)).toEqual({ before: 'بعد يوم واحد', figure: null, after: '' });
    expect(ar.days(2)).toEqual({ before: 'بعد يومين', figure: null, after: '' });
    expect(ar.days(5)).toEqual({ before: 'بعد ', figure: '5', after: ' أيام' });
    expect(ar.days(22)).toEqual({ before: 'بعد ', figure: '22', after: ' يومًا' });
    expect(ar.days(-1)).toEqual({ before: 'متأخر يومًا واحدًا', figure: null, after: '' });
    expect(ar.days(-9)).toEqual({ before: 'متأخر ', figure: '9', after: ' أيام' });
  });

  it('the deadline line — before it, and past it', () => {
    expect(phraseText(ar.deadline(5))).toBe('آخر موعد للتوريد بعد 5 أيام');
    expect(ar.deadline(5).figure).toBe('5');
    expect(phraseText(ar.deadline(0))).toBe('آخر موعد للتوريد اليوم');
    expect(phraseText(ar.deadline(-9))).toBe('متأخر 9 أيام عن آخر موعد للتوريد');
    expect(ar.deadline(-9)).toEqual({
      before: 'متأخر ',
      figure: '9',
      after: ' أيام عن آخر موعد للتوريد',
    });
  });

  it('what is left, as the strip heads it', () => {
    expect(phraseText(ar.leftHead(1))).toBe('المتبقي سيارة واحدة');
    expect(phraseText(ar.leftHead(2))).toBe('المتبقي سيارتان');
    expect(ar.leftHead(3)).toEqual({ before: 'المتبقي ', figure: '3', after: ' سيارات' });
  });
});

describe('names', () => {
  it('the deliveries count in words to ten, then by number', () => {
    expect(ar.deliveryName(1)).toBe('الاستلام الأول');
    expect(ar.deliveryName(3)).toBe('الاستلام الثالث');
    expect(ar.deliveryName(10)).toBe('الاستلام العاشر');
    expect(ar.deliveryName(11)).toBe('الاستلام رقم 11');
  });

  it('a contract with no name is called by its number', () => {
    expect(ar.contractName({ name: '  ', no: 3 })).toEqual({ text: 'عقد رقم 3', unnamed: true });
    expect(ar.contractName({ name: ' عقد توريد ', no: 3 })).toEqual({
      text: 'عقد توريد',
      unnamed: false,
    });
  });

  it('a file size in the forms group units', () => {
    expect(ar.fileSize(88_784)).toBe('87 ك.ب');
    expect(ar.fileSize(4_068_245)).toBe('3.9 م.ب');
    expect(ar.fileSize(10)).toBe('1 ك.ب');
  });
});

describe('the refusals the screens word themselves', () => {
  const rule = (code: string): ApiError =>
    new ApiError('BUSINESS_RULE_VIOLATION', 'refused', 422, [
      { field: 'counts.0.count', code, message: 'x' },
    ]);

  it('maps each server rule to its words', () => {
    expect(vehicleContractRefusalOf(new ApiError('STALE_DOCUMENT', 's', 409))).toBe('stale');
    expect(vehicleContractRefusalOf(rule('OVER_REMAINING'))).toBe('overRemaining');
    expect(vehicleContractRefusalOf(rule('INACTIVE_TYPE'))).toBe('inactiveType');
    expect(vehicleContractRefusalOf(rule('UNKNOWN_LINE'))).toBe('unknownLine');
    expect(vehicleContractRefusalOf(rule('BELOW_RECEIVED'))).toBe('belowReceived');
    expect(vehicleContractRefusalOf(rule('LINE_RECEIVED'))).toBe('lineReceived');
    expect(vehicleContractRefusalOf(rule('NOT_THE_LIVE_SET'))).toBe('notTheLiveSet');
    expect(vehicleContractRefusalOf(new ApiError('FILE_TOO_LARGE', 'big', 422))).toBe(
      'fileRefused',
    );
  });

  it('leaves everything else to the usual toast', () => {
    expect(vehicleContractRefusalOf(rule('SOMETHING_ELSE'))).toBeNull();
    expect(vehicleContractRefusalOf(new ApiError('NOT_FOUND', 'gone', 404))).toBeNull();
    expect(vehicleContractRefusalOf(new TypeError('offline'))).toBeNull();
  });

  it('every refusal has formal Arabic words in the dictionary', () => {
    for (const key of Object.values(REFUSAL_KEY)) {
      expect(translate('ar', key)).not.toBe(key);
      expect(translate('en', key)).not.toBe(key);
    }
  });
});
