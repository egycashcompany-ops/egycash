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
import { HrEvaluationBatchEvents } from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { type AuthContext } from '../../../../shared/types';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService } from '../../../../platform/files';
import { pdfDriverEnabled, renderPdfFromHtml } from '../../../../platform/pdf';
import { contractBrandingService } from '../../contracts/branding';
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

/**
 * The official list. Printed RTL in Arabic — this document leaves the building and is signed by
 * hand, so it carries the company header, the batch identity and a signature block.
 */
export const buildListHtml = (
  doc: EvaluationBatchDoc,
  branding: { logoDataUri: string | null; headerText: string; primaryColor: string },
): string => {
  const rows = liveItems(doc)
    .map(
      (item, index) => `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.applicantCode)}</td>
      <td>${escapeHtml(item.applicantName ?? '')}</td>
      <td>${escapeHtml(item.nationalId ?? '')}</td>
      <td>${escapeHtml(item.placementSnapshotLabel.position ?? '')}</td>
      <td>${escapeHtml(item.placementSnapshotLabel.branch ?? '')}</td>
      <td></td>
    </tr>`,
    )
    .join('\n');
  const logo =
    branding.logoDataUri === null
      ? ''
      : `<img class="logo" src="${branding.logoDataUri}" alt="" />`;
  const issued = (doc.issuedAt ?? doc.createdAt).toISOString().slice(0, 10);
  return `<section dir="rtl" lang="ar">
  <style>
    body { font-family: "Noto Naskh Arabic", "Segoe UI", sans-serif; color: #111; }
    header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid ${branding.primaryColor}; padding-bottom: 8px; }
    .logo { height: 48px; }
    h1 { font-size: 18px; margin: 0; }
    .meta { margin: 12px 0; font-size: 12px; }
    .meta span { margin-inline-end: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #999; padding: 4px 6px; text-align: right; }
    th { background: #f0f0f0; }
    .sign { margin-top: 32px; display: flex; justify-content: space-between; font-size: 12px; }
  </style>
  <header>${logo}<h1>${escapeHtml(branding.headerText)}</h1></header>
  <h2>${escapeHtml(doc.phaseName.ar)} — ${escapeHtml(doc.code)}</h2>
  <div class="meta">
    <span>${escapeHtml(doc.title ?? '')}</span>
    <span>تاريخ الإصدار: ${issued}</span>
    <span>عدد المرشحين: ${liveItems(doc).length}</span>
  </div>
  <table>
    <thead><tr><th>#</th><th>الكود</th><th>الاسم</th><th>الرقم القومي</th><th>الوظيفة</th><th>الفرع</th><th>النتيجة</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign"><div>توقيع المُصدِر: ______________</div><div>توقيع المستلم: ______________</div></div>
</section>`;
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
    const html = buildListHtml(doc, branding);
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
