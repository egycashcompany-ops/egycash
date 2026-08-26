// The package renderers are pure functions of the stored batch (RW8b) — the ZIP and the Files
// writes are exercised by the integration suite; these cover the document content itself.
//
// ONE FORM PER PHASE is what these mostly pin. The security check and the driving test are two
// different documents — they share no column but the name and the serial — and the single template
// that used to serve both is why they were reported as the same errand. So each form is checked
// for the columns it MUST carry and, just as importantly, for the ones it must NOT.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildListHtml, buildManifestCsv, type BatchCard } from './evaluation-batch-package';
import { type BatchItem, type EvaluationBatchDoc } from './evaluation-batch.model';

const item = (over: Partial<BatchItem>): BatchItem => ({
  applicantId: new Types.ObjectId(),
  applicantCode: 'APP-2026-000001',
  applicantName: 'أحمد محمد',
  evaluationId: new Types.ObjectId(),
  placementSnapshot: {
    jobTitleId: null,
    departmentId: null,
    branchId: null,
    sectionId: null,
  },
  placementSnapshotLabel: { position: 'أمين خزينة', branch: 'المعادي', department: 'العمليات' },
  nationalId: '29001011234567',
  motherName: 'فاطمة علي',
  address: 'شارع 9، المعادي، القاهرة',
  phone: '01012345678',
  result: 'pending',
  grade: null,
  reason: null,
  resultFileId: null,
  decidedBy: null,
  decidedAt: null,
  ...over,
});

const batch = (items: BatchItem[], over: Partial<EvaluationBatchDoc> = {}): EvaluationBatchDoc =>
  ({
    _id: new Types.ObjectId(),
    code: 'SEC-2026-000007',
    phaseKey: 'securityCheck',
    phaseName: { ar: 'الفحص الأمني', en: 'Security Check' },
    title: 'دفعة يوليو',
    items,
    issuedAt: new Date('2026-07-20T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  }) as unknown as EvaluationBatchDoc;

const driving = (items: BatchItem[]): EvaluationBatchDoc =>
  batch(items, {
    code: 'DRV-2026-000003',
    phaseKey: 'drivingTest',
    phaseName: { ar: 'اختبار القيادة', en: 'Driving Test' },
  } as Partial<EvaluationBatchDoc>);

const branding = { logoDataUri: null, headerText: 'EgyCash', primaryColor: '#0a0a0a' };

describe('evaluation batch package — manifest', () => {
  it('numbers the rows and quotes every cell', () => {
    const csv = buildManifestCsv(batch([item({}), item({ applicantCode: 'APP-2026-000002' })]));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"#","code","name","nationalId","position","branch","department"');
    expect(lines[1]).toContain('"1","APP-2026-000001"');
    expect(lines[2]).toContain('"2","APP-2026-000002"');
  });

  it('escapes a quote instead of breaking the column layout', () => {
    const csv = buildManifestCsv(batch([item({ applicantName: 'اسم "مستعار"' })]));
    expect(csv).toContain('"اسم ""مستعار"""');
  });

  it('leaves voided items out — they were retired before the package went out', () => {
    const csv = buildManifestCsv(batch([item({ result: 'voided' }), item({ applicantCode: 'APP-2' })]));
    const rows = csv.split('\r\n').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('"APP-2"');
  });
});

describe('the security check form', () => {
  it('prints the six columns the receiving body asks for, in order', () => {
    const html = buildListHtml(batch([item({})]), branding);
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    const headers = [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual(['م', 'الاسم', 'الوظيفة', 'الرقم القومى', 'العنوان', 'اسم الأم']);
    // …and the two values no other form in this system carries.
    expect(html).toContain('فاطمة علي');
    expect(html).toContain('شارع 9، المعادي، القاهرة');
  });

  it('prints no result column — the sheet goes out to be filled in', () => {
    const html = buildListHtml(batch([item({})]), branding);
    expect(html).not.toContain('<th>النتيجة</th>');
    expect(html).not.toContain('<th>الفرع</th>');
  });

  it('carries the batch identity so a loose sheet can be traced back', () => {
    const html = buildListHtml(batch([item({})]), branding);
    expect(html).toContain('SEC-2026-000007');
    expect(html).toContain('EgyCash');
    expect(html).toContain('dir="rtl"');
  });

  it('gives every ID card its own page, in row order', () => {
    const cards: BatchCard[] = [
      { applicantCode: 'APP-1', applicantName: 'أحمد', images: ['data:image/png;base64,AAA'] },
      { applicantCode: 'APP-2', applicantName: 'سارة', images: ['data:image/png;base64,BBB'] },
    ];
    const html = buildListHtml(batch([item({})]), branding, cards);
    expect(html.match(/class="card-page"/g)).toHaveLength(2);
    expect(html.indexOf('APP-1')).toBeLessThan(html.indexOf('APP-2'));
    expect(html).toContain('page-break-before: always');
  });

  it('names a member whose card is missing rather than shipping a shorter stack', () => {
    const cards: BatchCard[] = [{ applicantCode: 'APP-1', applicantName: 'أحمد', images: [] }];
    const html = buildListHtml(batch([item({})]), branding, cards);
    expect(html).toContain('لا توجد صورة بطاقة مرفقة');
    expect(html).toContain('APP-1');
  });
});

describe('the driving test form', () => {
  it('prints the phone and the four grade columns, and no national id', () => {
    const html = buildListHtml(driving([item({})]), branding);
    expect(html).toContain('نموذج إختبار سائقين');
    expect(html).toContain('01012345678');
    for (const label of ['ضعيف', 'جيد', 'جيد جداً', 'إمتياز']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('29001011234567');
    expect(html).not.toContain('اسم الأم');
  });

  it('is landscape, as the master is', () => {
    expect(buildListHtml(driving([item({})]), branding)).toContain('size: A4 landscape');
  });

  it('names both signatories', () => {
    const html = buildListHtml(driving([item({})]), branding);
    expect(html).toContain('ممثل إدارة الموارد البشرية');
    expect(html).toContain('الممتحن');
  });

  it('leaves the grade columns empty when nothing has come back', () => {
    const html = buildListHtml(driving([item({ grade: null })]), branding);
    expect(html).not.toContain('✓');
  });

  it('marks exactly the grade the examiner recorded', () => {
    const html = buildListHtml(driving([item({ grade: 'veryGood' })]), branding);
    expect(html.match(/✓/g)).toHaveLength(1);
  });
});

describe('any other phase still gets a usable list', () => {
  it('falls back rather than printing nothing for an admin-added phase', () => {
    const other = batch([item({})], {
      code: 'MED-2026-000001',
      phaseKey: 'someNewCheck',
      phaseName: { ar: 'فحص جديد', en: 'New check' },
    } as Partial<EvaluationBatchDoc>);
    const html = buildListHtml(other, branding);
    expect(html).toContain('MED-2026-000001');
    expect(html).toContain('فحص جديد');
    expect(html).toContain('<th>النتيجة</th>');
  });
});

describe('every form, whatever the phase', () => {
  it('escapes applicant-supplied text so a name can never inject markup', () => {
    for (const doc of [batch([item({ applicantName: '<script>x</script>' })]),
                       driving([item({ applicantName: '<script>x</script>' })])]) {
      const html = buildListHtml(doc, branding);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    }
  });

  it('counts only the live members', () => {
    const html = buildListHtml(batch([item({}), item({ result: 'voided' })]), branding);
    expect(html).toContain('العدد: 1');
  });
});
