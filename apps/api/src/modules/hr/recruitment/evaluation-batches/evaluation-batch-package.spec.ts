// The package renderers are pure functions of the stored batch (RW8b) — the ZIP and the Files
// writes are exercised by the integration suite; these cover the document content itself.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildListHtml, buildManifestCsv } from './evaluation-batch-package';
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
  result: 'pending',
  reason: null,
  resultFileId: null,
  decidedBy: null,
  decidedAt: null,
  ...over,
});

const batch = (items: BatchItem[]): EvaluationBatchDoc =>
  ({
    _id: new Types.ObjectId(),
    code: 'SEC-2026-000007',
    phaseName: { ar: 'الفحص الأمني', en: 'Security Check' },
    title: 'دفعة يوليو',
    items,
    issuedAt: new Date('2026-07-20T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  }) as unknown as EvaluationBatchDoc;

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

describe('evaluation batch package — official list', () => {
  it('carries the batch identity, the branding header and a signature block', () => {
    const html = buildListHtml(batch([item({})]), branding);
    expect(html).toContain('SEC-2026-000007');
    expect(html).toContain('الفحص الأمني');
    expect(html).toContain('EgyCash');
    expect(html).toContain('توقيع المستلم');
    expect(html).toContain('dir="rtl"');
  });

  it('escapes applicant-supplied text so a name can never inject markup', () => {
    const html = buildListHtml(batch([item({ applicantName: '<script>x</script>' })]), branding);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('counts only the live members', () => {
    const html = buildListHtml(batch([item({}), item({ result: 'voided' })]), branding);
    expect(html).toContain('عدد المرشحين: 1');
  });
});
