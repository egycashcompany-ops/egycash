// Template rules (frozen design D4/D7 + A17/A19): sanitized sections, catalog-validated
// placeholders, an append-only version chain (draft edits in place; editing a PUBLISHED
// version forks the next draft), a publishing gate, clone and archive. Every mutation is
// audited with who/when/what — history is recoverable by construction.
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type CloneContractTemplate,
  type ContractTemplateDto,
  type CreateContractTemplate,
  type TemplateSections,
  type UpdateContractTemplate,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { diffChanges } from '../../../../shared/utils/diff';
import { auditService } from '../../../../platform/audit';
import { contractTypeService } from '../contract-types';
import { extractPlaceholders, sanitizeTemplateHtml } from '../shared/template-html';
import { CATALOG_KEYS } from '../shared/variable-catalog';
import { contractTemplateRepository } from './contract-template.repository';
import { printSettings, type ContractTemplateDoc } from './contract-template.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'contractTemplate', entityId: id });

/** Rich-text "empty": no text content once tags/entities are stripped (`<p></p>` counts). */
const isBlankHtml = (html: string): boolean =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim() === '';

const auditSnapshot = (doc: ContractTemplateDoc): Record<string, unknown> => ({
  'name.en': doc.name.en,
  'name.ar': doc.name.ar,
  contractTypeId: doc.contractTypeId === null ? null : String(doc.contractTypeId),
  status: doc.status,
  header: doc.sections.header,
  body: doc.sections.body,
  footer: doc.sections.footer,
  logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
  signatures: JSON.stringify(doc.signatures),
  kind: printSettings(doc).kind,
  allJobs: printSettings(doc).allJobs,
  jobTitleIds: printSettings(doc).jobTitleIds.map(String).join(','),
  printOrder: printSettings(doc).printOrder,
});

class ContractTemplateService {
  /**
   * Sanitize sections + derive the placeholder list (D5/D6/A11). Unknown placeholders
   * do NOT block drafting — they surface as preview issues while authoring and hard-block
   * at publish, which enforces D5 where it matters: nothing unknown can ever generate.
   */
  private prepareSections(input: TemplateSections): { sections: TemplateSections; placeholders: string[] } {
    const sections = {
      header: sanitizeTemplateHtml(input.header),
      body: sanitizeTemplateHtml(input.body),
      footer: sanitizeTemplateHtml(input.footer),
    };
    const placeholders = extractPlaceholders(`${sections.header}\n${sections.body}\n${sections.footer}`);
    return { sections, placeholders };
  }

  async create(input: CreateContractTemplate, by: string): Promise<ContractTemplateDoc> {
    // A draft may not have picked its type yet; when it has, the type must exist.
    if (input.contractTypeId !== null) await contractTypeService.getById(input.contractTypeId);
    const { sections, placeholders } = this.prepareSections(input.sections);
    const doc = await contractTemplateRepository.create(
      {
        key: randomUUID(),
        name: input.name,
        language: input.language,
        contractTypeId: input.contractTypeId === null ? null : new Types.ObjectId(input.contractTypeId),
        status: 'draft',
        templateVersion: 1,
        sections,
        logoFileId: input.logoFileId === null ? null : new Types.ObjectId(input.logoFileId),
        signatures: input.signatures,
        kind: input.kind,
        allJobs: input.allJobs,
        jobTitleIds: input.jobTitleIds.map((jobTitleId) => new Types.ObjectId(jobTitleId)),
        printOrder: input.printOrder,
        placeholders,
        changedBy: new Types.ObjectId(by),
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, auditSnapshot(doc)),
    });
    return doc;
  }

  /**
   * Draft versions edit IN PLACE (audited with the field diff); editing a PUBLISHED
   * version forks the next draft version instead (A17/A19). Archived versions refuse.
   */
  async update(id: string, input: UpdateContractTemplate, by: string): Promise<ContractTemplateDoc> {
    const before = await contractTemplateRepository.getById(id);
    if (before.status === 'archived') {
      throw new BusinessRuleError('an archived template cannot be edited — clone it instead');
    }
    if (input.contractTypeId != null) await contractTypeService.getById(input.contractTypeId);
    const prepared = input.sections === undefined ? null : this.prepareSections(input.sections);
    const nextTypeId = (fallback: Types.ObjectId | null): Types.ObjectId | null =>
      input.contractTypeId === undefined
        ? fallback
        : input.contractTypeId === null
          ? null
          : new Types.ObjectId(input.contractTypeId);

    if (before.status === 'published') {
      const latest = await contractTemplateRepository.findLatestByKey(before.key);
      const next = await contractTemplateRepository.create(
        {
          key: before.key,
          name: input.name ?? before.name,
          language: before.language,
          contractTypeId: nextTypeId(before.contractTypeId),
          status: 'draft',
          templateVersion: (latest?.templateVersion ?? before.templateVersion) + 1,
          sections: prepared?.sections ?? before.sections,
          logoFileId:
            input.logoFileId === undefined
              ? before.logoFileId
              : input.logoFileId === null
                ? null
                : new Types.ObjectId(input.logoFileId),
          signatures: input.signatures ?? before.signatures,
          kind: input.kind ?? printSettings(before).kind,
          allJobs: input.allJobs ?? printSettings(before).allJobs,
          jobTitleIds:
            input.jobTitleIds === undefined
              ? printSettings(before).jobTitleIds
              : input.jobTitleIds.map((jobTitleId) => new Types.ObjectId(jobTitleId)),
          printOrder: input.printOrder ?? printSettings(before).printOrder,
          placeholders: prepared?.placeholders ?? before.placeholders,
          changedBy: new Types.ObjectId(by),
        },
        { by },
      );
      await auditService.record({
        entityRef: entityRef(String(next._id)),
        action: 'create',
        changes: diffChanges(auditSnapshot(before), auditSnapshot(next)),
      });
      return next;
    }

    const set: Record<string, unknown> = { changedBy: new Types.ObjectId(by) };
    if (input.name !== undefined) set.name = input.name;
    if (input.contractTypeId !== undefined) set.contractTypeId = nextTypeId(null);
    if (prepared !== null) {
      set.sections = prepared.sections;
      set.placeholders = prepared.placeholders;
    }
    if (input.logoFileId !== undefined) {
      set.logoFileId = input.logoFileId === null ? null : new Types.ObjectId(input.logoFileId);
    }
    if (input.signatures !== undefined) set.signatures = input.signatures;
    if (input.kind !== undefined) set.kind = input.kind;
    if (input.allJobs !== undefined) set.allJobs = input.allJobs;
    if (input.jobTitleIds !== undefined) {
      set.jobTitleIds = input.jobTitleIds.map((jobTitleId) => new Types.ObjectId(jobTitleId));
    }
    if (input.printOrder !== undefined) set.printOrder = input.printOrder;
    const after = await contractTemplateRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(auditSnapshot(before), auditSnapshot(after)),
    });
    return after;
  }

  /**
   * A17 — only published versions can generate; publishing supersedes prior published ones.
   * This is THE completeness gate: drafts save incomplete freely, but nothing incomplete
   * can ever publish (and therefore never generate a contract).
   */
  async publish(id: string, by: string, version: number): Promise<ContractTemplateDoc> {
    const doc = await contractTemplateRepository.getById(id);
    if (doc.status !== 'draft') throw new BusinessRuleError('only a draft version can be published');
    const missing: string[] = [];
    if (doc.name.ar.trim() === '') missing.push('Arabic name');
    if (doc.name.en.trim() === '') missing.push('English name');
    // A form is no contract: it has no type to carry (A27).
    const print = printSettings(doc);
    if (print.kind === 'contract' && doc.contractTypeId === null) missing.push('contract type');
    if (!print.allJobs && print.jobTitleIds.length === 0) missing.push('the jobs it is printed for');
    // A body of empty markup (e.g. the editor's leftover `<p></p>`) is still empty.
    if (isBlankHtml(doc.sections.body)) missing.push('body');
    if (doc.signatures.some((block) => block.label.trim() === '')) missing.push('signature labels');
    const unknown = doc.placeholders.filter((key) => !CATALOG_KEYS.has(key));
    if (missing.length > 0 || unknown.length > 0) {
      const parts = [
        ...(missing.length > 0 ? [`missing: ${missing.join(', ')}`] : []),
        ...(unknown.length > 0 ? [`unknown placeholders: ${unknown.map((key) => `{{${key}}}`).join(', ')}`] : []),
      ];
      throw new BusinessRuleError(`cannot publish an incomplete template — ${parts.join('; ')}`);
    }
    // The type must still exist.
    if (doc.contractTypeId !== null) await contractTypeService.getById(String(doc.contractTypeId));
    // The previous published version (if any) goes back to archived — one published per key.
    const current = await contractTemplateRepository.findPublishedByKey(doc.key);
    if (current !== null && String(current._id) !== id) {
      await contractTemplateRepository.systemSet(String(current._id), { status: 'archived' });
    }
    const after = await contractTemplateRepository.updateById(id, { status: 'published' }, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'templatePublished',
      changes: [{ field: 'templateVersion', old: current?.templateVersion ?? null, new: after.templateVersion }],
    });
    return after;
  }

  /** Clone into a NEW template key (v1 draft) — the Q2 cross-language path. */
  async clone(id: string, input: CloneContractTemplate, by: string): Promise<ContractTemplateDoc> {
    const source = await contractTemplateRepository.getById(id);
    const doc = await contractTemplateRepository.create(
      {
        key: randomUUID(),
        name: input.name ?? { en: `${source.name.en} (copy)`, ar: `${source.name.ar} (نسخة)` },
        language: input.language ?? source.language,
        contractTypeId: source.contractTypeId,
        status: 'draft',
        templateVersion: 1,
        sections: source.sections,
        logoFileId: source.logoFileId,
        signatures: source.signatures,
        ...printSettings(source),
        placeholders: source.placeholders,
        changedBy: new Types.ObjectId(by),
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'templateCloned',
      changes: [{ field: 'sourceTemplateId', old: null, new: id }],
    });
    return doc;
  }

  /** Archive a version (hides the key from new drafts when its latest is archived). */
  async archive(id: string, by: string, version: number): Promise<ContractTemplateDoc> {
    const doc = await contractTemplateRepository.getById(id);
    if (doc.status === 'archived') return doc;
    const after = await contractTemplateRepository.updateById(id, { status: 'archived' }, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: doc.status, new: 'archived' }],
    });
    return after;
  }

  async getById(id: string): Promise<ContractTemplateDoc> {
    return contractTemplateRepository.getById(id);
  }

  /** A template a CONTRACT may be made from — a hiring form (A27) is printed, never contracted. */
  async contractTemplateById(id: string): Promise<ContractTemplateDoc> {
    const doc = await contractTemplateRepository.getById(id);
    if (printSettings(doc).kind === 'form') {
      throw new BusinessRuleError('a hiring form cannot be the template of a contract');
    }
    return doc;
  }

  /** Every published template, contracts and forms (A27's printed set picks from these). */
  async listPublished(): Promise<ContractTemplateDoc[]> {
    return contractTemplateRepository.listPublished();
  }

  /** The version generation must pin (A17): the key's PUBLISHED version. */
  async publishedVersionOf(anyVersionId: string): Promise<ContractTemplateDoc> {
    const doc = await contractTemplateRepository.getById(anyVersionId);
    const published = await contractTemplateRepository.findPublishedByKey(doc.key);
    if (published === null) {
      throw new BusinessRuleError(
        'this template has no published version',
        ErrorCodes.CONTRACT_TEMPLATE_NOT_PUBLISHED,
      );
    }
    return published;
  }

  /** Nullable variant for list annotations (the create wizard's published pin). */
  async publishedOf(key: string): Promise<ContractTemplateDoc | null> {
    return contractTemplateRepository.findPublishedByKey(key);
  }

  async pinnedVersion(key: string, templateVersion: number): Promise<ContractTemplateDoc> {
    const doc = await contractTemplateRepository.findVersion(key, templateVersion);
    if (doc === null) throw new NotFoundError('template version not found');
    return doc;
  }

  async listLatest(): Promise<ContractTemplateDoc[]> {
    return contractTemplateRepository.listLatestPerKey();
  }

  async listVersions(key: string): Promise<ContractTemplateDoc[]> {
    return contractTemplateRepository.listVersions(key);
  }

  toDto(doc: ContractTemplateDoc): ContractTemplateDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      language: doc.language,
      contractTypeId: doc.contractTypeId === null ? null : String(doc.contractTypeId),
      status: doc.status,
      templateVersion: doc.templateVersion,
      sections: doc.sections,
      logoFileId: doc.logoFileId === null ? null : String(doc.logoFileId),
      signatures: doc.signatures,
      ...printSettings(doc),
      jobTitleIds: printSettings(doc).jobTitleIds.map(String),
      placeholders: doc.placeholders,
      changedBy: doc.changedBy === null ? null : String(doc.changedBy),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      version: doc.__v,
    };
  }
}

export const contractTemplateService = new ContractTemplateService();
