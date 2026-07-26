// Data access only (ADR-003).
import { type FilterQuery } from 'mongoose';
import { type ListContractTemplatesQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { ContractTemplateModel, type ContractTemplateDoc } from './contract-template.model';

class ContractTemplateRepository extends BaseRepository<ContractTemplateDoc> {
  constructor() {
    super(ContractTemplateModel, {});
  }

  async findLatestByKey(key: string): Promise<ContractTemplateDoc | null> {
    return this.model
      .findOne({ key, isDeleted: false })
      .sort({ templateVersion: -1 })
      .lean<ContractTemplateDoc>()
      .exec();
  }

  async findVersion(key: string, templateVersion: number): Promise<ContractTemplateDoc | null> {
    return this.model
      .findOne({ key, templateVersion, isDeleted: false })
      .lean<ContractTemplateDoc>()
      .exec();
  }

  async findPublishedByKey(key: string): Promise<ContractTemplateDoc | null> {
    return this.model
      .findOne({ key, status: 'published', isDeleted: false })
      .sort({ templateVersion: -1 })
      .lean<ContractTemplateDoc>()
      .exec();
  }

  async listVersions(key: string): Promise<ContractTemplateDoc[]> {
    return this.model
      .find({ key, isDeleted: false })
      .sort({ templateVersion: -1 })
      .lean<ContractTemplateDoc[]>()
      .exec();
  }

  async listPage(query: ListContractTemplatesQuery): Promise<Paginated<ContractTemplateDoc>> {
    const filter: FilterQuery<ContractTemplateDoc> = {};
    if (query.language !== undefined) filter.language = query.language;
    if (query.contractTypeId !== undefined) filter.contractTypeId = query.contractTypeId;
    if (query.status !== undefined) filter.status = query.status;
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'updatedAt',
      sortDir: 'desc',
      sortableFields: ['updatedAt', 'createdAt'],
    });
  }

  /** Boot/system writes without optimistic concurrency (publish supersede). */
  async systemSet(id: string, set: Record<string, unknown>): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  /** Latest version per key (the templates list view), filtered in memory after grouping. */
  async listLatestPerKey(): Promise<ContractTemplateDoc[]> {
    const all = await this.model
      .find({ isDeleted: false })
      .sort({ key: 1, templateVersion: -1 })
      .lean<ContractTemplateDoc[]>()
      .exec();
    const seen = new Set<string>();
    return all.filter((doc) => (seen.has(doc.key) ? false : (seen.add(doc.key), true)));
  }
}

export const contractTemplateRepository = new ContractTemplateRepository();
