// The worker-side PDF job (frozen design D8/A13/A14/A15/A21): consumes ONLY the stored
// snapshot (A11/A20), appends the A14 integrity line, renders via the platform chromium
// seam, and stores ONE immutable Files record per contract version. With the driver
// disabled (no CHROMIUM_PATH — dev/CI) generation completes without a PDF and the
// print-view fallback serves exports.
import { CONTRACT_DOCUMENTS_FILE_CATEGORY, type CreateFileCategory } from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { type AuthContext } from '../../../../shared/types';
import { fileCategoryService, fileService } from '../../../../platform/files';
import { pdfDriverEnabled, renderPdfFromHtml } from '../../../../platform/pdf';
import { contractRepository } from './contract.repository';

const CONTRACTS_CATEGORY: CreateFileCategory = {
  key: CONTRACT_DOCUMENTS_FILE_CATEGORY,
  name: { ar: 'مستندات العقود', en: 'Contract documents' },
  allowedMimeTypes: ['application/pdf'],
  maxSizeMb: 20,
  retentionDays: null,
};

let cachedCategoryId: string | null = null;
const resolveCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    cachedCategoryId = String((await fileCategoryService.ensure(CONTRACTS_CATEGORY))._id);
  }
  return cachedCategoryId;
};

/** Minimal system context for the worker-side store (route permissions don't apply here). */
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

/** Handles `hr.contract.renderRequested` (reliable tier → executes in the worker). */
export const renderContractPdf = async (contractId: string): Promise<void> => {
  const doc = await contractRepository.findById(contractId);
  if (doc === null || doc.renderedHtml === null || doc.generation.integrity === null) return;
  if (doc.generation.pdfFileId !== null) return; // A15 — one immutable file per version
  await contractRepository.systemSet(contractId, { 'generation.status': 'rendering' });
  try {
    const integrity = doc.generation.integrity;
    const line = `${integrity.generatedAt.toISOString()} · ${integrity.generatorVersion} · template v${integrity.templateVersion} · contract v${integrity.contractVersion} · SHA-256 ${integrity.sha256}`;
    const html = doc.renderedHtml.replace('</footer>', `<div class="integrity">${line}</div></footer>`);
    const pdf = await renderPdfFromHtml(html);
    if (pdf === null) {
      // Driver disabled — completed without a PDF; print view remains the export path (D8).
      await contractRepository.systemSet(contractId, {
        'generation.status': 'completed',
        'generation.completedAt': new Date(),
      });
      if (pdfDriverEnabled()) logger.warn({ contractId }, 'pdf driver returned null');
      return;
    }
    const file = await fileService.upload(
      systemCtx(String(doc.createdBy ?? doc.employeeId)),
      {
        moduleId: 'hr',
        entityType: 'contract',
        entityId: contractId,
        categoryId: await resolveCategoryId(),
        displayName: `${doc.code} v${doc.contractVersion}.pdf`,
        visibility: 'private',
        tags: [],
      },
      { originalName: `${doc.code}-v${doc.contractVersion}.pdf`, mime: 'application/pdf', size: pdf.length, buffer: pdf },
    );
    await contractRepository.systemSet(contractId, {
      'generation.status': 'completed',
      'generation.completedAt': new Date(),
      'generation.pdfFileId': file._id,
    });
  } catch (error) {
    logger.error({ err: error, contractId }, 'contract pdf rendering failed');
    await contractRepository.systemSet(contractId, {
      'generation.status': 'failed',
      'generation.error': error instanceof Error ? error.message : 'pdf rendering failed',
    });
  }
};
