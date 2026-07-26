// Data access only (ADR-003). Scoped by the employee's branch (denormalized on the doc).
import { Types, type FilterQuery } from 'mongoose';
import { type ListContractsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { ContractModel, type ContractDoc } from './contract.model';

const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

class ContractRepository extends BaseRepository<ContractDoc> {
  constructor() {
    super(ContractModel, { branchField: 'branchId' });
  }

  async listPage(query: ListContractsQuery, scope: ScopeSelector): Promise<Paginated<ContractDoc>> {
    const filter: FilterQuery<ContractDoc> = {};
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.typeId !== undefined) filter.typeId = new Types.ObjectId(query.typeId);
    if (query.status !== undefined) filter.status = query.status;
    if (query.startFrom !== undefined || query.startTo !== undefined) {
      filter.startDate = {
        ...(query.startFrom === undefined ? {} : { $gte: dateOnly(query.startFrom) }),
        ...(query.startTo === undefined ? {} : { $lte: dateOnly(query.startTo) }),
      };
    }
    if (query.endFrom !== undefined || query.endTo !== undefined) {
      filter.endDate = {
        ...(query.endFrom === undefined ? {} : { $gte: dateOnly(query.endFrom) }),
        ...(query.endTo === undefined ? {} : { $lte: dateOnly(query.endTo) }),
      };
    }
    if (query.expiringWithinDays !== undefined) {
      filter.status = { $in: ['active', 'signed'] };
      filter.endDate = {
        $ne: null,
        $lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
      };
    }
    if (query.search !== undefined && query.search.trim() !== '') {
      const pattern = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { code: pattern },
        { employeeName: pattern },
        { employeeCode: pattern },
        { referenceNumber: pattern },
      ];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'startDate', 'endDate', 'code', 'status'],
      scope,
    });
  }

  /** Q3 gate: contracts of this employee+type that block another active one. */
  async findBlockingActive(employeeId: string, typeId: string): Promise<ContractDoc | null> {
    return this.model
      .findOne({
        employeeId: new Types.ObjectId(employeeId),
        typeId: new Types.ObjectId(typeId),
        status: { $in: ['draft', 'pendingApproval', 'approved', 'active', 'signed'] },
        isDeleted: false,
      })
      .lean<ContractDoc>()
      .exec();
  }

  async listForEmployee(employeeId: string): Promise<ContractDoc[]> {
    return this.model
      .find({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .sort({ startDate: -1, contractVersion: -1 })
      .lean<ContractDoc[]>()
      .exec();
  }

  /** D11 sweep input: fixed-term active/signed contracts whose end date has passed. */
  async findOverdue(asOf: Date, limit = 500): Promise<ContractDoc[]> {
    return this.model
      .find({ status: { $in: ['active', 'signed'] }, endDate: { $ne: null, $lte: asOf }, isDeleted: false })
      .limit(limit)
      .lean<ContractDoc[]>()
      .exec();
  }

  /** D11 notices: ending within the window, not yet noticed. */
  async findExpiringSoon(windowDays: number, limit = 500): Promise<ContractDoc[]> {
    return this.model
      .find({
        status: { $in: ['active', 'signed'] },
        endDate: { $ne: null, $gt: new Date(), $lte: new Date(Date.now() + windowDays * 86_400_000) },
        expiryNoticeSentAt: null,
        isDeleted: false,
      })
      .limit(limit)
      .lean<ContractDoc[]>()
      .exec();
  }

  /** Worker-side generation-state writes: no optimistic concurrency, no scope. */
  async systemSet(id: string, set: Record<string, unknown>): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  /** A22 — the version in force for an employee at a date (started, not superseded after). */
  async findActiveAt(employeeId: string, at: Date): Promise<ContractDoc | null> {
    return this.model
      .findOne({
        employeeId: new Types.ObjectId(employeeId),
        startDate: { $lte: at },
        status: { $in: ['active', 'signed', 'amended', 'renewed', 'terminated', 'expired', 'archived'] },
        renderedHtml: { $ne: null },
        isDeleted: false,
        $or: [{ endDate: null }, { endDate: { $gte: at } }],
      })
      .sort({ startDate: -1, contractVersion: -1 })
      .lean<ContractDoc>()
      .exec();
  }
}

export const contractRepository = new ContractRepository();
