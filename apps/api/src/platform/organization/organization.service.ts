// The Organization singleton profile (ADR-015).
import { Types } from 'mongoose';
import { PlatformEvents, type OrganizationDto, type UpdateOrganization } from '@ecms/contracts';
import { NotFoundError, StaleDocumentError } from '../../shared/errors';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { emit } from '../kernel/event-bus';
import { OrganizationModel, type OrganizationDoc } from './organization.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'organization',
  entityId: id,
});

const snapshot = (doc: OrganizationDoc) => ({
  name: doc.name,
  legalName: doc.legalName,
  taxNumber: doc.taxNumber,
  commercialRegistry: doc.commercialRegistry,
  fiscalYearStartMonth: doc.fiscalYearStartMonth,
});

class OrganizationService {
  async get(): Promise<OrganizationDoc> {
    const doc = await OrganizationModel.findOne().lean<OrganizationDoc>().exec();
    if (doc === null) throw new NotFoundError('Organization profile is not initialized');
    return doc;
  }

  /** Idempotent — used by seed/boot. */
  async ensure(defaults: { name: { ar: string; en: string } }): Promise<OrganizationDoc> {
    const existing = await OrganizationModel.findOne().lean<OrganizationDoc>().exec();
    if (existing !== null) return existing;
    const created = await OrganizationModel.create([{ name: defaults.name }]);
    const doc = created[0];
    if (doc === undefined) throw new NotFoundError();
    return doc.toObject();
  }

  async update(input: UpdateOrganization, by: string): Promise<OrganizationDoc> {
    const before = await this.get();
    const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(by) };
    if (input.name !== undefined) set.name = input.name;
    if (input.legalName !== undefined) set.legalName = input.legalName;
    if (input.taxNumber !== undefined) set.taxNumber = input.taxNumber;
    if (input.commercialRegistry !== undefined) set.commercialRegistry = input.commercialRegistry;
    if (input.fiscalYearStartMonth !== undefined)
      set.fiscalYearStartMonth = input.fiscalYearStartMonth;

    const after = await OrganizationModel.findOneAndUpdate(
      { _id: before._id, __v: input.version },
      { $set: set, $inc: { __v: 1 } },
      { new: true },
    )
      .lean<OrganizationDoc>()
      .exec();
    if (after === null) throw new StaleDocumentError();

    await auditService.record({
      entityRef: entityRef(String(after._id)),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    await emit(PlatformEvents.OrganizationUpdated, { organizationId: String(after._id) });
    return after;
  }

  toDto(doc: OrganizationDoc): OrganizationDto {
    return {
      id: String(doc._id),
      name: doc.name,
      legalName: doc.legalName,
      taxNumber: doc.taxNumber,
      commercialRegistry: doc.commercialRegistry,
      fiscalYearStartMonth: doc.fiscalYearStartMonth,
      version: doc.__v,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const organizationService = new OrganizationService();
