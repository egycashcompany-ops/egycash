// A24 — branding profile service: singleton ensure, audited updates, the public-visibility
// logo upload, and the render-time resolution (logo embedded as a data URI so the frozen
// snapshot is self-contained and deterministic — A20/A21).
import { Types } from 'mongoose';
import { type ContractBrandingDto, type UpdateContractBranding } from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { diffChanges } from '../../../../shared/utils/diff';
import { auditService } from '../../../../platform/audit';
import { fileCategoryService, fileService, type UploadedBinary } from '../../../../platform/files';
import { ContractBrandingModel, type ContractBrandingDoc } from './contract-branding.model';

export interface RenderBranding {
  logoDataUri: string | null;
  headerText: string;
  footerText: string;
  watermark: string;
  primaryColor: string;
}

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'contractBranding', entityId: id });

const auditSnapshot = (doc: ContractBrandingDoc): Record<string, unknown> => ({
  'headerText.ar': doc.headerText.ar,
  'headerText.en': doc.headerText.en,
  'footerText.ar': doc.footerText.ar,
  'footerText.en': doc.footerText.en,
  'watermark.ar': doc.watermark.ar,
  'watermark.en': doc.watermark.en,
  primaryColor: doc.primaryColor,
  logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
});

class ContractBrandingRepository extends BaseRepository<ContractBrandingDoc> {
  constructor() {
    super(ContractBrandingModel, {});
  }
}
const repository = new ContractBrandingRepository();

class ContractBrandingService {
  /** The singleton — created with defaults on first access. */
  async get(by: string): Promise<ContractBrandingDoc> {
    const existing = await repository.findOne({});
    if (existing !== null) return existing;
    return repository.create(
      {
        headerText: { ar: '', en: '' },
        footerText: { ar: '', en: '' },
        watermark: { ar: '', en: '' },
        primaryColor: '#111111',
        logoFileId: null,
      },
      { by },
    );
  }

  async update(ctx: AuthContext, input: UpdateContractBranding): Promise<ContractBrandingDoc> {
    const before = await this.get(ctx.userId);
    const set: Record<string, unknown> = {};
    if (input.headerText !== undefined) set.headerText = input.headerText;
    if (input.footerText !== undefined) set.footerText = input.footerText;
    if (input.watermark !== undefined) set.watermark = input.watermark;
    if (input.primaryColor !== undefined) set.primaryColor = input.primaryColor;
    if (input.logoFileId !== undefined) {
      set.logoFileId = input.logoFileId === null ? null : new Types.ObjectId(input.logoFileId);
    }
    const after = await repository.updateById(String(before._id), set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(String(after._id)),
      action: 'update',
      changes: diffChanges(auditSnapshot(before), auditSnapshot(after)),
    });
    return after;
  }

  /** Logo upload: PUBLIC visibility so any authenticated render context can embed it. */
  async uploadLogo(ctx: AuthContext, binary: UploadedBinary): Promise<ContractBrandingDoc> {
    const before = await this.get(ctx.userId);
    const category = await fileCategoryService.ensure({
      key: 'hr.contractBranding',
      name: { ar: 'هوية العقود', en: 'Contract branding' },
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      maxSizeMb: 5,
      retentionDays: null,
    });
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'contractBranding',
        entityId: String(before._id),
        categoryId: String(category._id),
        displayName: 'contract-logo',
        visibility: 'public',
        tags: [],
      },
      binary,
    );
    const after = await repository.updateById(
      String(before._id),
      { logoFileId: file._id },
      { by: ctx.userId, version: before.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(after._id)),
      action: 'update',
      changes: [{ field: 'logoFileId', old: auditSnapshot(before).logoFileId, new: String(file._id) }],
    });
    return after;
  }

  /** Render-time resolution: language-picked lines + the logo as a data URI. */
  async resolveRenderBranding(ctx: AuthContext, language: 'ar' | 'en'): Promise<RenderBranding> {
    const doc = await this.get(ctx.userId);
    let logoDataUri: string | null = null;
    if (doc.logoFileId !== null) {
      const read = await fileService.readBuffer(ctx, String(doc.logoFileId)).catch(() => null);
      if (read !== null) {
        logoDataUri = `data:${read.doc.mime};base64,${read.buffer.toString('base64')}`;
      }
    }
    return {
      logoDataUri,
      headerText: doc.headerText[language],
      footerText: doc.footerText[language],
      watermark: doc.watermark[language],
      primaryColor: doc.primaryColor,
    };
  }

  toDto(doc: ContractBrandingDoc): ContractBrandingDto {
    return {
      headerText: doc.headerText,
      footerText: doc.footerText,
      watermark: doc.watermark,
      primaryColor: doc.primaryColor,
      logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
      version: doc.__v,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const contractBrandingService = new ContractBrandingService();
