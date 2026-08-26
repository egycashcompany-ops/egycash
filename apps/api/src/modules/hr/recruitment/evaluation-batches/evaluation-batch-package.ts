// RW8b — the worker-side package job. Issuing a batch queues this; it builds three artifacts and
// stores them in the Files service:
//
//   1. the official PDF list  — rendered through the existing chromium seam
//   2. the manifest CSV       — the same rows in machine-readable form
//   3. the export package     — one ZIP holding list.pdf, manifest.csv and
//                               attachments/<applicantCode>/… for every member
//
// With the PDF driver disabled (no CHROMIUM_PATH — dev/CI) the batch still issues: the ZIP is
// built without `list.pdf` and the package reports the reason, exactly the graceful degradation
// contracts uses. The job is retryable from the UI.
import archiver from 'archiver';
import { DRIVING_TEST_GRADES, HrEvaluationBatchEvents } from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { type AuthContext } from '../../../../shared/types';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService } from '../../../../platform/files';
import { pdfDriverEnabled, renderPdfFromHtml } from '../../../../platform/pdf';
import { contractBrandingService } from '../../contracts/branding';
import { resolveNationalIdCardCategoryId } from '../applicants/national-id-card.files';
import { DRIVING_GRADE_LABELS } from './batch-form-fields';
import { resolveEvaluationBatchCategoryId } from './evaluation-batch.files';
import { type BatchItem, type EvaluationBatchDoc } from './evaluation-batch.model';
import { evaluationBatchRepository } from './evaluation-batch.repository';

/** Minimal system context for the worker-side reads/writes (route permissions don't apply here). */
const systemCtx = (userId: string): AuthContext => ({
  userId,
  sessionId: 'system',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 0,
  isPrivileged: true,
});

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** RFC-4180 quoting — a name with a comma must not shift every following column. */
const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const liveItems = (doc: EvaluationBatchDoc): BatchItem[] =>
  doc.items.filter((i) => i.result !== 'voided');

export const buildManifestCsv = (doc: EvaluationBatchDoc): string => {
  const header = ['#', 'code', 'name', 'nationalId', 'position', 'branch', 'department'];
  const rows = liveItems(doc).map((item, index) =>
    [
      String(index + 1),
      item.applicantCode,
      item.applicantName ?? '',
      item.nationalId ?? '',
      item.placementSnapshotLabel.position ?? '',
      item.placementSnapshotLabel.branch ?? '',
      item.placementSnapshotLabel.department ?? '',
    ].map(csvCell).join(','),
  );
  return [header.map(csvCell).join(','), ...rows].join('\r\n');
};

/** Shared chrome: the company header every generated form carries. */
const headerHtml = (
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
  subtitle: string,
): string => {
  const logo =
    branding.logoDataUri === null ? '' : `<img class="logo" src="${branding.logoDataUri}" alt="" />`;
  return `<header>${logo}<div><h1>${escapeHtml(branding.headerText)}</h1><div class="dept">${escapeHtml(subtitle)}</div></div></header>`;
};

const BASE_CSS = `
  body { font-family: "Noto Naskh Arabic", "Segoe UI", sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; }
  .logo { height: 48px; }
  h1 { font-size: 16px; margin: 0; }
  .dept { font-size: 12px; color: #444; }
  h2 { font-size: 15px; margin: 10px 0 4px; text-align: center; }
  .meta { margin: 8px 0; font-size: 12px; }
  .meta span { margin-inline-end: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #333; padding: 4px 6px; text-align: right; }
  th { background: #f0f0f0; }
  td.num { text-align: center; width: 34px; }
`;

/**
 * The SECURITY CHECK form (`securityCheck`).
 *
 * Its columns are the ones the receiving body asks for and no others: name, job, national id,
 * address, mother's name. No code, no branch, no result — the sheet goes out to be filled in, and
 * a column nobody writes in is a column that confuses the person holding the pen.
 *
 * The master template carries no header at all. This one does, by an explicit decision: an
 * unheaded sheet cannot be traced back to the batch that produced it once it is on a desk with
 * twenty others.
 *
 * `cards` are the National-ID images, ONE PER PAGE after the table, in the same order as the rows.
 */
const securityCheckHtml = (
  doc: EvaluationBatchDoc,
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
  cards: readonly BatchCard[],
): string => {
  const rows = liveItems(doc)
    .map(
      (item, index) => `<tr>
      <td class="num">${index + 1}</td>
      <td>${escapeHtml(item.applicantName ?? '')}</td>
      <td>${escapeHtml(item.placementSnapshotLabel.position ?? '')}</td>
      <td dir="ltr">${escapeHtml(item.nationalId ?? '')}</td>
      <td>${escapeHtml(item.address ?? '')}</td>
      <td>${escapeHtml(item.motherName ?? '')}</td>
    </tr>`,
    )
    .join('\n');
  const issued = (doc.issuedAt ?? doc.createdAt).toISOString().slice(0, 10);
  // Each card gets its own page. A candidate with no card on file is still named, so the reader
  // knows a page is missing rather than silently receiving a shorter stack.
  const cardPages = cards
    .map(
      (card) => `<section class="card-page">
      <div class="card-name">${escapeHtml(card.applicantName)} — ${escapeHtml(card.applicantCode)}</div>
      ${card.images.map((src) => `<img class="card" src="${src}" alt="" />`).join('\n')}
      ${card.images.length === 0 ? '<div class="card-missing">لا توجد صورة بطاقة مرفقة</div>' : ''}
    </section>`,
    )
    .join('\n');
  return `<section dir="rtl" lang="ar">
  <style>
    ${BASE_CSS}
    header { border-bottom: 2px solid ${branding.primaryColor}; }
    .card-page { page-break-before: always; text-align: center; }
    .card-name { font-size: 13px; margin-bottom: 8px; font-weight: bold; }
    .card { max-width: 100%; max-height: 44vh; margin: 6px auto; display: block; border: 1px solid #999; }
    .card-missing { font-size: 12px; color: #666; margin-top: 24px; }
  </style>
  ${headerHtml(branding, 'إدارة الموارد البشرية')}
  <h2>${escapeHtml(doc.phaseName.ar)}</h2>
  <div class="meta">
    <span>رقم الدفعة: ${escapeHtml(doc.code)}</span>
    <span>التاريخ: ${issued}</span>
    <span>العدد: ${liveItems(doc).length}</span>
  </div>
  <table>
    <thead><tr>
      <th class="num">م</th><th>الاسم</th><th>الوظيفة</th>
      <th>الرقم القومى</th><th>العنوان</th><th>اسم الأم</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${cardPages}
</section>`;
};

/**
 * The DRIVING TEST form (`drivingTest`) — landscape, as the master is.
 *
 * The rating is four tick columns under one merged head, and they are printed EMPTY when nothing
 * has come back yet: this sheet's job is to be filled in by hand at the wheel. When a grade has
 * since been recorded the same template marks it, so a returned batch reprints as the record of
 * what the examiner decided rather than as a fresh blank.
 *
 * Two named signatories, because the master names two: the HR representative who sent the
 * candidates and the examiner who tested them.
 */
const drivingTestHtml = (
  doc: EvaluationBatchDoc,
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
): string => {
  const grades = DRIVING_TEST_GRADES;
  const rows = liveItems(doc)
    .map(
      (item, index) => `<tr>
      <td class="num">${index + 1}</td>
      <td>${escapeHtml(item.applicantName ?? '')}</td>
      <td dir="ltr">${escapeHtml(item.phone ?? '')}</td>
      ${grades.map((g) => `<td class="tick">${item.grade === g ? '✓' : ''}</td>`).join('')}
      <td>${escapeHtml(item.reason ?? '')}</td>
    </tr>`,
    )
    .join('\n');
  const issued = (doc.issuedAt ?? doc.createdAt).toISOString().slice(0, 10);
  return `<section dir="rtl" lang="ar">
  <style>
    @page { size: A4 landscape; }
    ${BASE_CSS}
    header { border-bottom: 2px solid ${branding.primaryColor}; }
    td.tick { text-align: center; width: 56px; font-size: 14px; }
    th.tick { width: 56px; text-align: center; }
    .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 12px; }
    .sign div { min-width: 220px; }
    .sign .who { font-weight: bold; margin-bottom: 6px; }
    .sign .line { margin-top: 10px; }
  </style>
  ${headerHtml(branding, 'إدارة الموارد البشرية')}
  <h2>نموذج إختبار سائقين</h2>
  <div class="meta">
    <span>رقم الدفعة: ${escapeHtml(doc.code)}</span>
    <span>التاريخ: ${issued}</span>
    <span>العدد: ${liveItems(doc).length}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="num" rowspan="2">#</th>
        <th rowspan="2">الإسم</th>
        <th rowspan="2">رقم التليفون</th>
        <th class="tick" colspan="${grades.length}">التقييم</th>
        <th rowspan="2">ملاحظات</th>
      </tr>
      <tr>${grades.map((g) => `<th class="tick">${DRIVING_GRADE_LABELS[g].ar}</th>`).join('')}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign">
    <div><div class="who">ممثل إدارة الموارد البشرية</div><div class="line">الإسم: ____________</div><div class="line">التوقيع: ____________</div></div>
    <div><div class="who">الممتحن</div><div class="line">الإسم: ____________</div><div class="line">التوقيع: ____________</div></div>
  </div>
</section>`;
};

/**
 * Any OTHER batch phase — the shape this file used to print for everything.
 *
 * Phases stay admin-configurable, so a fourth batch phase can be added with no code change and
 * still gets a usable, identified list. It is a fallback, not a form: a new external check with
 * its own paperwork earns its own template here.
 */
const genericListHtml = (
  doc: EvaluationBatchDoc,
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
): string => {
  const rows = liveItems(doc)
    .map(
      (item, index) => `<tr>
      <td class="num">${index + 1}</td>
      <td>${escapeHtml(item.applicantCode)}</td>
      <td>${escapeHtml(item.applicantName ?? '')}</td>
      <td dir="ltr">${escapeHtml(item.nationalId ?? '')}</td>
      <td>${escapeHtml(item.placementSnapshotLabel.position ?? '')}</td>
      <td>${escapeHtml(item.placementSnapshotLabel.branch ?? '')}</td>
      <td></td>
    </tr>`,
    )
    .join('\n');
  const issued = (doc.issuedAt ?? doc.createdAt).toISOString().slice(0, 10);
  return `<section dir="rtl" lang="ar">
  <style>
    ${BASE_CSS}
    header { border-bottom: 2px solid ${branding.primaryColor}; }
    .sign { margin-top: 32px; display: flex; justify-content: space-between; font-size: 12px; }
  </style>
  ${headerHtml(branding, 'إدارة الموارد البشرية')}
  <h2>${escapeHtml(doc.phaseName.ar)} — ${escapeHtml(doc.code)}</h2>
  <div class="meta">
    <span>${escapeHtml(doc.title ?? '')}</span>
    <span>تاريخ الإصدار: ${issued}</span>
    <span>عدد المرشحين: ${liveItems(doc).length}</span>
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>الكود</th><th>الاسم</th><th>الرقم القومي</th><th>الوظيفة</th><th>الفرع</th><th>النتيجة</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign"><div>توقيع المُصدِر: ______________</div><div>توقيع المستلم: ______________</div></div>
</section>`;
};

/** One member's National-ID images, already loaded as data URIs. */
export interface BatchCard {
  applicantCode: string;
  applicantName: string;
  images: readonly string[];
}

/**
 * The official list — ONE FORM PER PHASE (the fix this file exists for).
 *
 * A security check and a driving test are two different documents: they share no column but the
 * name and the serial, one is portrait and one landscape, one wants an address and a mother's name
 * and the other a phone and a four-level grade. Printing one template for both, with only the
 * heading changing, is what made them look like the same errand.
 *
 * Dispatch is on `phaseKey`, which is stable and seeded; anything unrecognised gets the generic
 * list rather than nothing.
 */
export const buildListHtml = (
  doc: EvaluationBatchDoc,
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
  cards: readonly BatchCard[] = [],
): string => {
  if (doc.phaseKey === 'securityCheck') return securityCheckHtml(doc, branding, cards);
  if (doc.phaseKey === 'drivingTest') return drivingTestHtml(doc, branding);
  return genericListHtml(doc, branding);
};

/**
 * The National-ID images for one member, as data URIs the renderer can inline.
 *
 * Only files in the National-ID CATEGORY — an applicant's other attachments (a CV, a certificate)
 * are in the ZIP already and have no business in a security list. A member with no card on file
 * still gets an entry with no images, so the form names them and says the page is missing rather
 * than quietly shipping a shorter stack.
 *
 * A file that cannot be read is skipped, never fatal: the package must still go out.
 */
const cardsOf = async (
  ctx: AuthContext,
  items: readonly BatchItem[],
  categoryId: string,
): Promise<BatchCard[]> => {
  const out: BatchCard[] = [];
  for (const item of items) {
    const files = await fileService
      .list(
        {
          page: 1,
          pageSize: 10,
          sortDir: 'asc',
          moduleId: 'hr',
          entityType: 'applicant',
          entityId: String(item.applicantId),
          categoryId,
        },
        { scope: 'organization', userId: ctx.userId, branchId: null, departmentId: null, sectionId: null },
      )
      .catch(() => null);
    const images: string[] = [];
    for (const file of files?.items ?? []) {
      const read = await fileService.readBuffer(ctx, String(file._id)).catch(() => null);
      if (read === null || !read.doc.mime.startsWith('image/')) continue;
      images.push(`data:${read.doc.mime};base64,${read.buffer.toString('base64')}`);
    }
    out.push({
      applicantCode: item.applicantCode,
      applicantName: item.applicantName ?? '',
      images,
    });
  }
  return out;
};

/** Collect an applicant's attachments as ZIP entries; a missing file never fails the package. */
const attachmentsOf = async (
  ctx: AuthContext,
  item: BatchItem,
): Promise<{ name: string; buffer: Buffer }[]> => {
  const files = await fileService
    .list(
      { page: 1, pageSize: 50, sortDir: 'desc', moduleId: 'hr', entityType: 'applicant', entityId: String(item.applicantId) },
      { scope: 'organization', userId: ctx.userId, branchId: null, departmentId: null, sectionId: null },
    )
    .catch(() => null);
  if (files === null) return [];
  const out: { name: string; buffer: Buffer }[] = [];
  for (const file of files.items) {
    const read = await fileService.readBuffer(ctx, String(file._id)).catch(() => null);
    if (read === null) continue;
    out.push({ name: `attachments/${item.applicantCode}/${read.doc.originalName}`, buffer: read.buffer });
  }
  return out;
};

const zip = async (entries: { name: string; buffer: Buffer }[]): Promise<Buffer> => {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
  });
  for (const entry of entries) archive.append(entry.buffer, { name: entry.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
};

/** Handles `hr.evaluationBatch.generated` (reliable tier → executes in the worker). */
export const buildEvaluationBatchPackage = async (batchId: string): Promise<void> => {
  const doc = await evaluationBatchRepository.findByIdSystem(batchId);
  if (doc === null || doc.status === 'draft' || doc.status === 'cancelled') return;
  await evaluationBatchRepository.systemSet(batchId, { 'package.status': 'building' });
  const ctx = systemCtx(String(doc.issuedBy ?? doc.createdBy ?? doc._id));
  try {
    const branding = await contractBrandingService
      .resolveRenderBranding(ctx, 'ar')
      .catch(() => ({ logoDataUri: null, headerText: '', primaryColor: '#111111' }));
    const manifestCsv = buildManifestCsv(doc);
    // The card pages are the security form's alone; loading them for every phase would read and
    // base64 every image in a batch that will never print one.
    const cards =
      doc.phaseKey === 'securityCheck'
        ? await cardsOf(ctx, liveItems(doc), await resolveNationalIdCardCategoryId()).catch(() => [])
        : [];
    const html = buildListHtml(doc, branding, cards);
    const pdf = await renderPdfFromHtml(html);

    const entries: { name: string; buffer: Buffer }[] = [
      { name: 'manifest.csv', buffer: Buffer.from(manifestCsv, 'utf8') },
    ];
    if (pdf !== null) entries.push({ name: 'list.pdf', buffer: pdf });
    let attachmentCount = 0;
    for (const item of liveItems(doc)) {
      const files = await attachmentsOf(ctx, item);
      attachmentCount += files.length;
      entries.push(...files);
    }
    const archive = await zip(entries);

    const categoryId = await resolveEvaluationBatchCategoryId();
    const upload = (
      displayName: string,
      originalName: string,
      mime: string,
      buffer: Buffer,
    ): ReturnType<typeof fileService.upload> =>
      fileService.upload(
        ctx,
        {
          moduleId: 'hr',
          entityType: 'evaluationBatch',
          entityId: batchId,
          categoryId,
          displayName,
          visibility: 'private',
          tags: [],
        },
        { originalName, mime, size: buffer.length, buffer },
      );

    const listPdf = pdf === null ? null : await upload(`${doc.code} list`, `${doc.code}-list.pdf`, 'application/pdf', pdf);
    const archiveFile = await upload(`${doc.code} package`, `${doc.code}.zip`, 'application/zip', archive);

    await evaluationBatchRepository.systemSet(batchId, {
      'package.status': 'ready',
      'package.listPdfFileId': listPdf === null ? null : listPdf._id,
      'package.archiveFileId': archiveFile._id,
      'package.manifestCsv': manifestCsv,
      'package.attachmentCount': attachmentCount,
      'package.builtAt': new Date(),
      // With no driver the package is still usable — the reason rides along so the UI can say so.
      'package.error': pdf === null ? 'the PDF driver is disabled; the package holds no list.pdf' : null,
    });
    if (pdf === null && pdfDriverEnabled()) logger.warn({ batchId }, 'pdf driver returned null');
    await emit(HrEvaluationBatchEvents.BatchPackageReady, {
      batchId,
      code: doc.code,
      ...(listPdf === null ? {} : { listPdfFileId: String(listPdf._id) }),
      archiveFileId: String(archiveFile._id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'package build failed';
    logger.error({ err: error, batchId }, 'evaluation batch package build failed');
    await evaluationBatchRepository.systemSet(batchId, {
      'package.status': 'failed',
      'package.error': message,
    });
    await emit(HrEvaluationBatchEvents.BatchPackageFailed, {
      batchId,
      code: doc.code,
      error: message,
    }).catch(() => undefined);
  }
};
