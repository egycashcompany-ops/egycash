// Every input below is a value that literally appears in the go-live workbook, with its count where
// the count is what makes the case matter. The recurring assertion is the same one: an unrecognised
// value maps to `null` so a human sees it, never to a plausible default that quietly becomes a fact
// on somebody's file.
import { describe, expect, it } from 'vitest';
import {
  educationLevel,
  exitType,
  insuranceStatus,
  maritalStatus,
  militaryStatus,
  orgKey,
  weaponLicenseType,
} from './vocabulary';

describe('militaryStatus — sixteen spellings for four real states', () => {
  it('reads the three spellings of "served" as one status', () => {
    // 477 + 438 + 47 employees. Three spellings, one fact.
    expect(militaryStatus('ادى الخدمه')).toBe('completed');
    expect(militaryStatus('ادى الخدمة')).toBe('completed');
    expect(militaryStatus('أدى الخدمة')).toBe('completed');
    expect(militaryStatus('ادى')).toBe('completed');
  });

  /**
   * 214 officers plus honorary ranks and NCOs. An officer HAS served, so the status is `completed`;
   * the rank itself is not lost — it goes onto the officer block, which is where a rank belongs.
   */
  it('reads a rank as completed service, keeping the rank for the officer block', () => {
    expect(militaryStatus('ظابط')).toBe('completed');
    expect(militaryStatus('ضابط')).toBe('completed'); // the correct spelling, which also occurs
    expect(militaryStatus('ظابط شرف')).toBe('completed');
    expect(militaryStatus('عريف')).toBe('completed');
  });

  it('separates exemption from postponement', () => {
    expect(militaryStatus('اعفاء')).toBe('exempted');
    expect(militaryStatus('اعفاء نهائي')).toBe('exempted');
    // Neither exempt nor served — his turn has not come, or he has been called up.
    expect(militaryStatus('اعفاء مؤقت')).toBe('postponed');
    expect(militaryStatus('لم يصبه الدور')).toBe('postponed');
    expect(militaryStatus('مطلوب للتجنيد')).toBe('postponed');
  });

  it('refuses the junk in that column rather than defaulting it', () => {
    // Three cells hold dates and one holds `نموذج`. A guessed military status is a false statement.
    expect(militaryStatus('نموذج')).toBeNull();
    expect(militaryStatus('2025-02-28 00:00:00')).toBeNull();
    expect(militaryStatus(null)).toBeNull();
  });
});

describe('exitType — eleven reasons for five types', () => {
  it('reads both spellings of resignation', () => {
    // 700 + 144.
    expect(exitType('استقالة')).toBe('resignation');
    expect(exitType('استقاله')).toBe('resignation');
  });

  it('reads all four spellings of death', () => {
    for (const v of ['الوفاه', 'الوفاة', 'حالة وفاة', 'متوفى']) expect(exitType(v), v).toBe('death');
  });

  /**
   * The distinction worth being deliberate about: absconding and unsuitability are the COMPANY
   * ending the employment, so they are terminations. A contract simply running out is not, and the
   * difference follows the person into any future rehire decision.
   */
  it('separates being dismissed from a contract running out', () => {
    expect(exitType('انقطاع')).toBe('termination');
    expect(exitType('عدم صلاحية')).toBe('termination');
    expect(exitType('ايقاف')).toBe('termination');
    expect(exitType('عدم تجديد')).toBe('endOfContract');
    expect(exitType('انتهاء التعاقد')).toBe('endOfContract');
  });

  it('refuses an unknown reason', () => {
    expect(exitType('سبب اخر')).toBeNull();
  });
});

describe('insuranceStatus — a column contaminated with job titles', () => {
  it('reads the four real answers, both spellings each', () => {
    expect(insuranceStatus('غير مؤمن عليه')).toBe('notInsured');
    expect(insuranceStatus('مؤمن علية')).toBe('insured');
    expect(insuranceStatus('مؤمن عليه')).toBe('insured');
  });

  /**
   * Ten of the fourteen distinct values in this column are job titles that landed in the wrong
   * column, plus a bare `÷`. Recording "this employee's insurance status is: driver" would be worse
   * than recording nothing, so these become rejection-report lines instead.
   */
  it('refuses the job titles that ended up in the insurance-status column', () => {
    for (const v of ['سائق', 'اخصائى صراف الى', 'قائد طاقم', 'امين خزينة', '÷']) {
      expect(insuranceStatus(v), v).toBeNull();
    }
  });
});

describe('weaponLicenseType', () => {
  it('maps the three kinds the sheet records', () => {
    expect(weaponLicenseType('شخصى')).toBe('personal');
    expect(weaponLicenseType('شركة')).toBe('company');
    expect(weaponLicenseType('موتوسيكل')).toBe('motorcycle');
  });

  it('refuses an unknown kind', () => {
    expect(weaponLicenseType('اعفاء قوات مسلحه')).toBeNull();
  });
});

describe('educationLevel reads the level off the qualification', () => {
  it('handles the common qualifications', () => {
    // 226 distinct strings; the level is the opening word of nearly all of them.
    expect(educationLevel('بكالوريوس تجاره')).toBe('bachelor');
    expect(educationLevel('ليسانس حقوق')).toBe('bachelor');
    expect(educationLevel('دبلوم تجارى')).toBe('diploma');
    expect(educationLevel('ماجستير اداره اعمال')).toBe('master');
    expect(educationLevel('بكالوريوس اداره لوجيستيه')).toBe('bachelor');
  });

  it('returns null rather than guessing when the level is not stated', () => {
    // The full string is preserved as the specialization, so nothing is lost by not guessing.
    expect(educationLevel('كلية القادة والاركان')).toBeNull();
    expect(educationLevel(null)).toBeNull();
  });
});

describe('orgKey lets one section spelled two ways meet', () => {
  it('folds the spacing and conjunction variants the sheet contains', () => {
    expect(orgKey('الرقابة والمستهلكات')).toBe(orgKey('الرقابة و المستهلكات'));
    expect(orgKey('التشغيل ( ادارى )')).toBe(orgKey('التشغيل ( إدارى )'));
    expect(orgKey('التشغيل (خارجى)')).toBe(orgKey('التشغيل ( خارجى )'));
    expect(orgKey('خارجية (  البنك التجارى الدولى )')).toBe(orgKey('خارجية ( البنك التجارى الدولى )'));
  });

  it('keeps genuinely different sections apart', () => {
    expect(orgKey('التشغيل')).not.toBe(orgKey('التجهيز'));
    expect(orgKey('التشغيل ( خارجى )')).not.toBe(orgKey('التشغيل ( تحميل )'));
    // Two different banks at the same kind of site are two different sections.
    expect(orgKey('التشغيل ( خارجى ) ( بنك مصر )')).not.toBe(
      orgKey('التشغيل ( خارجى ) ( بنك القاهره )'),
    );
  });

  it('is for matching only — it never becomes the stored name', () => {
    // The org unit is CREATED with the sheet's own spelling; this key only finds an existing one.
    expect(orgKey('الرقابة والمستهلكات')).not.toBe('الرقابة والمستهلكات');
  });
});

describe('maritalStatus', () => {
  it('maps the four values exactly', () => {
    expect(maritalStatus('اعزب')).toBe('single');
    expect(maritalStatus('متزوج')).toBe('married');
    expect(maritalStatus('مطلق')).toBe('divorced');
    expect(maritalStatus('ارمل')).toBe('widowed');
  });
});
