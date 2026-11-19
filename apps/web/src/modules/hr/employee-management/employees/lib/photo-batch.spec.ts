// «متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن الأسماء ممكن يبقي فيها حروف متلغبطه أو
// مسافات)» — the code decides; the name only warns.
import { describe, expect, it } from 'vitest';
import { type EmployeeCodeMatchDto } from '@ecms/contracts';
import {
  asciiDigits,
  codesToLookUp,
  countByStatus,
  LONGEST_CODE,
  markDuplicates,
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

  it('tries an external code before the digits inside it, and keeps it out of the name', () => {
    const parsed = parsePhotoName('EX-2900 احمد محمد.jpg');
    expect(parsed.candidates.slice(0, 2)).toEqual(['EX-2900', '2900']);
    expect(parsed.nameInFile).toBe('احمد محمد');
  });

  it.each(['EX-2900_Ahmed.jpg', 'EX-2900-Ahmed.jpg', 'EX-2900.Ahmed.jpg', 'EX-2900احمد.jpg'])(
    'finds the external code in %s, however it is joined to the name',
    (name) => {
      expect(parsePhotoName(name).candidates).toContain('EX-2900');
    },
  );

  it('never lets a stray word of letters and digits beat the long number', () => {
    expect(parsePhotoName('0101469 Ahmed C2.jpg').candidates[0]).toBe('0101469');
    expect(parsePhotoName('IMG-1 0101469 Ahmed.jpg').candidates[0]).toBe('0101469');
  });


  it('asks about no run of digits longer than any code can be', () => {
    const stamp = '2023110514302212345678901234567';
    expect(stamp.length).toBeGreaterThan(LONGEST_CODE);
    expect(parsePhotoName(`0101469 أحمد ${stamp}.jpg`).candidates).toEqual(['0101469']);
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

  it('lets a corrected photo follow one already uploaded, without a duplicate', () => {
    const files = [file('0101469 محمد.jpg'), file('0101469 محمد مصطفى.jpg')];
    const rows = planPhotoBatch(files, matches, new Set(), new Set(['0101469 محمد.jpg']));
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready']);
  });

  it('hands back the rows it does not mark as they were', () => {
    const rows = planPhotoBatch([file('0102000 أحمد.jpg')], matches, new Set());
    expect(markDuplicates(rows)[0]).toBe(rows[0]);
  });

  it('keeps a Latin name joined to the matched code by dashes', () => {
    const rows = planPhotoBatch(
      [file('0101469-Ahmed-Ali.jpg'), file('Mohamed-Hassan-0102000.jpg')],
      matches,
      new Set(),
    );
    expect(rows.map((r) => [r.code, r.nameInFile])).toEqual([
      ['0101469', 'Ahmed Ali'],
      ['0102000', 'Mohamed Hassan'],
    ]);
  });

  it('reads the name beside the code that matched, an external one included', () => {
    const outside = new Map([['EX-2900', employee('EX-2900', 'احمد محمد علي')]]);
    const [row] = planPhotoBatch([file('EX-2900-Ahmed احمد.jpg')], outside, new Set());
    expect(row?.code).toBe('EX-2900');
    expect(row?.nameInFile).toBe('Ahmed احمد');
  });

  it('holds a name whose codes belong to different people, never guessing between them', () => {
    const people = new Map([
      ['C2', employee('C2', 'احمد محمد سيد')],
      ['0101845', employee('0101845', 'احمد محمد عبد الله')],
    ]);
    const [row] = planPhotoBatch([file('C2 احمد محمد 0101845.jpg')], people, new Set());
    expect(row?.status).toBe('ambiguous');
    expect(row?.employee).toBeNull();
    expect([...(row?.rivalCodes ?? [])].sort()).toEqual(['0101845', 'C2']);
  });

  it('takes one person reached by two codes in the name as that person', () => {
    const one = employee('0101469', 'محمد مصطفى');
    const both = new Map([
      ['0101469', one],
      ['EX-0101469', one],
    ]);
    expect(planPhotoBatch([file('EX-0101469 محمد.jpg')], both, new Set())[0]?.status).toBe('ready');
  });

  it('pads nothing in a name that already holds a full-length number, such as a camera date', () => {
    expect(parsePhotoName('20231105_101845.jpg').padded).toEqual([]);
    const camera = new Map([['0101845', employee('0101845', 'احمد محمد')]]);
    expect(planPhotoBatch([file('20231105_101845.jpg')], camera, new Set())[0]?.status).toBe(
      'unknownCode',
    );
  });

  it('sends a padded match only when the name in the file backs it', () => {
    const rows = planPhotoBatch(
      [file('101469.jpg'), file('101469 سارة علي.jpg'), file('101469 محمد مصطفي.jpg')],
      matches,
      new Set(),
    );
    expect(rows.map((r) => r.status)).toEqual(['unconfirmed', 'unconfirmed', 'ready']);
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
    expect(countByStatus(rows)).toMatchObject({ ready: 1, unknownCode: 1, duplicate: 0, ambiguous: 0 });
  });
});
