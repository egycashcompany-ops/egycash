// «مستندات التعيين» — everything one employee signs on joining, printed in one go (A27).
//
// «عاوز يجبلي كل الحاجه اللي هتتطبع للشخص دا علي حسب وظيفتو … سواق كانت من العقد او نمازج التعيين
// الخاصة بيه». The set is the employee's CONTRACT first, then every PUBLISHED form whose jobs
// include the employee's job (or that is for every job), in each form's print order.
//
// THE CONTRACT IS THE REAL ONE. When the employee already has a generated contract, its pinned
// template version and its FROZEN variables are printed — the same content as its snapshot (A21),
// never a fresh resolution against data that has moved since. When there is none, the set makes
// one, the way HR would by hand: from the contract template of the employee's job, starting on the
// employment's start date, for one year when the type is fixed-term («اه بس على حسب وظيفته») —
// through the ordinary create and generate, so numbering, approval and every A16 check apply.
// Whatever stops that (no template for the job, approval required, a required value missing, a
// caller who may not create contracts) is reported beside the set, and the forms still print.
//
// A FORM IS NOT A CONTRACT. It is rendered fresh each time, keeps no snapshot and fails nothing:
// a value the record lacks prints as a dotted line to fill in by hand.
import { ErrorCodes, type HiringPackContractNote, type HiringPackDto } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { addDays, dateOnlyIso } from '../../shared/business-date';
import { employeeService } from '../../employee-management/employees';
import { type EmployeeDoc } from '../../employee-management/employees/employee.model';
import { contractBrandingService } from '../branding';
import { contractTypeService } from '../contract-types';
import { contractTemplateService } from '../contract-templates';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { resolveContractVariables } from './contract-variables';
import { renderHiringPackHtml, type HiringPackPart } from './contract-render';
import { letterheadFor } from './letterhead';
import { contractService } from './contract.service';
import { type ContractDoc } from './contract.model';

/** A generated contract that is still the employee's: printable as it stands. */
const PRINTABLE = new Set(['active', 'signed']);
/** A contract on its way: the set finishes it when it may, or says why it cannot. */
const IN_PROGRESS = new Set(['draft', 'pendingApproval', 'approved']);

/** Does this template print for `jobTitleId`? */
export const appliesToJob = (template: ContractTemplateDoc, jobTitleId: string): boolean => {
  const settings = printSettings(template);
  return settings.allJobs || settings.jobTitleIds.some((id) => String(id) === jobTitleId);
};

/** The published templates an employee's job prints, contracts and forms, in print order. */
export const templatesForJob = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
): { contracts: ContractTemplateDoc[]; forms: ContractTemplateDoc[] } => {
  const mine = published
    .filter((template) => appliesToJob(template, jobTitleId))
    .sort(
      (a, b) =>
        printSettings(a).printOrder - printSettings(b).printOrder || a.name.ar.localeCompare(b.name.ar, 'ar'),
    );
  return {
    contracts: mine.filter((template) => printSettings(template).kind === 'contract'),
    forms: mine.filter((template) => printSettings(template).kind === 'form'),
  };
};

/** One year from `start`, the day before its anniversary: 15/11/2026 → 14/11/2027. */
export const oneYearFrom = (start: Date): Date => {
  const next = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  return addDays(next, -1);
};

class HiringPackService {
  /**
   * The employee's contract for the set: one already generated, or one this request finishes or
   * makes. Never throws for a reason the HR clerk can act on — it reports it as the note.
   */
  private async contractFor(
    ctx: AuthContext,
    employee: EmployeeDoc,
    contractTemplates: readonly ContractTemplateDoc[],
    scope: ScopeSelector,
  ): Promise<{ doc: ContractDoc | null; created: boolean; note: HiringPackContractNote | null }> {
    const id = String(employee._id);
    const contracts = await contractService.listForEmployee(id);
    const printable = contracts.find((c) => PRINTABLE.has(c.status) && c.renderedHtml !== null);
    if (printable !== undefined) return { doc: printable, created: false, note: null };

    const mayMake = hasPermission(ctx, 'contract.create') && hasPermission(ctx, 'contract.generate');
    let pending = contracts.find((c) => IN_PROGRESS.has(c.status)) ?? null;
    let created = false;
    if (pending === null) {
      const template = contractTemplates[0];
      if (template === undefined || template.contractTypeId === null) {
        return { doc: null, created: false, note: 'noTemplate' };
      }
      if (!mayMake) return { doc: null, created: false, note: 'notPermitted' };
      const type = await contractTypeService.getById(String(template.contractTypeId));
      const start = employee.employment.startDate;
      try {
        pending = await contractService.createDraft(
          ctx,
          {
            employeeId: id,
            typeId: String(template.contractTypeId),
            templateId: String(template._id),
            startDate: dateOnlyIso(start),
            endDate: type.allowsEndDate ? dateOnlyIso(oneYearFrom(start)) : null,
            referenceNumber: null,
            overrides: [],
          },
          scope,
        );
        created = true;
      } catch (error) {
        if (error instanceof AppError && error.httpStatus < 500) {
          return { doc: null, created: false, note: 'notCreated' };
        }
        throw error;
      }
    }

    if (!mayMake) return { doc: null, created, note: 'notPermitted' };
    const needsApproval = pending.approval !== null && pending.status !== 'approved';
    if (needsApproval) return { doc: null, created, note: 'approvalRequired' };
    try {
      const generated = await contractService.generate(ctx, String(pending._id), pending.__v, scope);
      return { doc: generated, created, note: null };
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCodes.CONTRACT_VARIABLES_MISSING) {
        return { doc: null, created, note: 'missingValues' };
      }
      if (error instanceof AppError && error.httpStatus < 500) {
        return { doc: null, created, note: 'notCreated' };
      }
      throw error;
    }
  }

  async build(ctx: AuthContext, employeeId: string, scope: ScopeSelector): Promise<HiringPackDto> {
    const employee = await employeeService.getById(employeeId, scope);
    const jobTitleId = String(employee.employment.jobTitleId);
    const { contracts, forms } = templatesForJob(await contractTemplateService.listPublished(), jobTitleId);

    const parts: HiringPackPart[] = [];
    const documents: HiringPackDto['documents'] = [];
    const contract = await this.contractFor(ctx, employee, contracts, scope);
    if (contract.doc !== null && contract.doc.pinnedTemplateVersion !== null) {
      const pinned = await contractTemplateService.pinnedVersion(
        contract.doc.templateKey,
        contract.doc.pinnedTemplateVersion,
      );
      parts.push({
        kind: 'contract',
        template: pinned,
        values: contract.doc.variables,
        options: { branding: await contractBrandingService.resolveRenderBranding(ctx, pinned.language) },
      });
      documents.push({ key: pinned.key, name: pinned.name, kind: 'contract' });
    }

    for (const form of forms) {
      // A form fails nothing: whatever is missing prints as a line to fill in by hand.
      const { values } = await resolveContractVariables(form.placeholders, {
        employee,
        code: contract.doc?.code ?? '',
        startDate: dateOnlyIso(employee.employment.startDate),
        endDate: null,
        language: form.language,
        overrides: {},
        overriddenBy: null,
      });
      parts.push({ kind: 'form', template: form, values });
      documents.push({ key: form.key, name: form.name, kind: 'form' });
    }

    const language = parts[0]?.template.language ?? 'ar';
    const html = renderHiringPackHtml(parts, language, await letterheadFor(language));
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: employeeId },
      action: 'export',
      changes: [
        { field: 'format', old: null, new: 'hiringPack' },
        { field: 'documents', old: null, new: documents.map((d) => d.key).join(',') },
      ],
      actor: { userId: ctx.userId, ip: null, userAgent: null },
    });
    return {
      html,
      contract:
        contract.doc === null
          ? null
          : { id: String(contract.doc._id), code: contract.doc.code, created: contract.created },
      contractNote: contract.note,
      documents,
    };
  }
}

export const hiringPackService = new HiringPackService();
