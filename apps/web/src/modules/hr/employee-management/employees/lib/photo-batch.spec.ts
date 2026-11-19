// «متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن الأسماء ممكن يبقي فيها حروف متلغبطه أو
// مسافات)» — the code decides; the name only warns.
import { describe, expect, it } from 'vitest';
import { type EmployeeCodeMatchDto } from '@ecms/contracts';
import {
  asciiDigits,
  codesToLookUp,
  countByStatus,
  nameLikeness,
  NAME_LIKENESS_FLOOR,
  parsePhotoName,
  planPhotoBatch,
  type PhotoFileInput,
} from './photo-batch';

const employee = (code: string, fullNameAr: string, photoFileId: string | null = null): EmployeeCodeMatchDto => ({
  id: `id-${code}`,
  code,
  fullNameAr,
  fullNameEn: null,
  status: 'active',
  photoFileId,
});
const file = (name: string, type = 'image/jpeg'): PhotoFileInput => ({ key: name, name, type });

describe('reading a code out of a file name', () => {
  it.each([
    ['0101469 محمد مصطفى محمد احمد.jpg', '0101469', 'محمد مصطفى محمد احمد'],
    ['0101469محمد مصطفى.jpeg', '0101469', 'محمد مصطفى'],
    ['محمد   مصطفى 0101469.png', '0101469', 'محمد مصطفى'],
    ['0101469_محمد_مصطفى.JPG', '0101469', 'محمد مصطفى'],
    ['0101469 - محمد مصطفى (2).webp', '0101469', 'محمد مصطفى'],
    ['٠١٠١٤٦٩ محمد.jpg', '0101469', 'محمد'],
  ])('%s → %s', (name, code, nameInFile) => {
    const parsed = parsePhotoName(name);
    expect(parsed.candidates[0]).toBe(code);
    expect(parsed.nameInFile).toBe(nameInFile);
  });

  it('tries the zeros a spreadsheet drops, since no code is that short', () => {
    const parsed = parsePhotoName('101469 محمد.jpg');
    expect(parsed.candidates).toEqual(['101469', '0101469']);
    expect(parsed.padded).toEqual(['0101469']);
    expect(parsePhotoName('01469 محمد.jpg').padded).toEqual(['0001469']);
  });

  it('pads no short number that cannot be a code, such as a copy\'s «(2)»', () => {
    expect(parsePhotoName('0101469 محمد (2).jpg').candidates).toEqual(['0101469', '2']);
    expect(parsePhotoName('1469 محمد.jpg').padded).toEqual([]);
  });

  it('tries every run of digits, longest first, and an external code word', () => {
    expect(parsePhotoName('2023 0101469 محمد.jpg').candidates.slice(0, 2)).toEqual(['0101469', '2023']);
    expect(parsePhotoName('EXT-12 Ahmed.jpg').candidates).toContain('EXT-12');
  });

  it('finds no code in a name without digits', () => {
    expect(parsePhotoName('محمد مصطفى.jpg').candidates).toEqual([]);
  });

  it('reads Arabic-Indic digits', () => {
    expect(asciiDigits('٠١٢۳۴')).toBe('01234');
  });
});

describe('the name, as a check only', () => {
  it('forgives mixed-up letters and spaces', () => {
    expect(nameLikeness('محمد مصطفي محمد احمد', 'محمد مصطفى محمد أحمد')).toBe(1);
    expect(nameLikeness('محمدمصطفى', 'محمد مصطفى محمد أحمد')).toBe(1);
    expect(nameLikeness('محمد مصطفى', 'محمد مصطفى محمد أحمد')).toBe(1);
    expect(nameLikeness('محمد مصطفي محمد احمد عبده', 'محمد مصطفى محمد أحمد')).toBeGreaterThan(
      NAME_LIKENESS_FLOOR,
    );
  });

  it('notices a name that belongs to somebody else', () => {
    expect(nameLikeness('سارة علي حسن', 'محمد مصطفى محمد أحمد')).toBeLessThan(NAME_LIKENESS_FLOOR);
  });

  it('raises nothing when the file carries no name', () => {
    expect(nameLikeness('', 'محمد مصطفى')).toBe(1);
  });
});

describe('the batch plan', () => {
  const matches = new Map([
    ['0101469', employee('0101469', 'محمد مصطفى محمد أحمد', 'old-photo')],
    ['0102000', employee('0102000', 'أحمد علي حسن')],
  ]);

  it('matches by code only, and flags a name that does not look like the employee', () => {
    const rows = planPhotoBatch(
      [file('0101469 محمد مصطفي.jpg'), file('0102000 سارة إبراهيم.jpg')],
      matches,
      new Set(),
    );
    expect(rows.map((r) => [r.status, r.employee?.code, r.nameDiffers])).toEqual([
      ['ready', '0101469', false],
      ['ready', '0102000', true],
    ]);
  });

  it('says what is wrong with each file it will not send', () => {
    const rows = planPhotoBatch(
      [file('0999999 محمد.jpg'), file('محمد.jpg'), file('0102000 أحمد.gif', 'image/gif')],
      matches,
      new Set(),
    );
    expect(rows.map((r) => r.status)).toEqual(['unknownCode', 'noCode', 'unsupported']);
  });

  it('marks two files for one employee, until all but one are left out', () => {
    const files = [file('0101469 محمد.jpg'), file('0101469 محمد (2).jpg')];
    expect(planPhotoBatch(files, matches, new Set()).map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
    ]);
    const kept = planPhotoBatch(files, matches, new Set(['0101469 محمد (2).jpg']));
    expect(kept.map((r) => r.status)).toEqual(['ready', 'excluded']);
  });

  it('matches a code whose leading zero was dropped, and says so', () => {
    const [row] = planPhotoBatch([file('101469 محمد.jpg')], matches, new Set());
    expect(row?.status).toBe('ready');
    expect(row?.code).toBe('0101469');
    expect(row?.padded).toBe(true);
  });

  it('asks the server about every code any file could carry, each once', () => {
    expect(codesToLookUp([file('101469 a.jpg'), file('0101469 b.jpg')])).toEqual(['101469', '0101469']);
  });

  it('counts the rows by state for the summary', () => {
    const rows = planPhotoBatch([file('0101469 م.jpg'), file('0999999 م.jpg')], matches, new Set());
    expect(countByStatus(rows)).toMatchObject({ ready: 1, unknownCode: 1, duplicate: 0 });
  });
});
