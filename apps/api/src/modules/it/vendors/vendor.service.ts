// Vendor admin (design §2.9). Reference data: audited, no events.
import {
  type CreateItVendor,
  type ListItVendorsQuery,
  type Paginated,
  type UpdateItVendor,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { itVendorRepository } from './vendor.repository';
import { type ItVendorDoc } from './vendor.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'vendor', entityId: id });

const snapshot = (doc: ItVendorDoc) => ({
  name: doc.name,
  code: doc.code,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  services: doc.services,
  contacts: doc.contacts,
  isActive: doc.isActive,
});

const toContacts = (
  contacts: CreateItVendor['contacts'],
): ItVendorDoc['contacts'] =>
  contacts.map((c) => ({
    name: c.name,
    role: c.role ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
  }));

class ItVendorService {
  async create(input: CreateItVendor, by: string): Promise<ItVendorDoc> {
    const existing = await itVendorRepository.findByName(input.name);
    if (existing !== null) throw new ConflictError(`vendor "${input.name}" already exists`);
    const doc = await itVendorRepository.create(
      {
        name: input.name,
        code: input.code ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        services: input.services ?? null,
        contacts: toContacts(input.contacts),
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListItVendorsQuery): Promise<Paginated<ItVendorDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: pattern }, { code: pattern }, { services: pattern }];
    }
    return itVendorRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'name'],
    });
  }

  async update(id: string, input: UpdateItVendor, by: string): Promise<ItVendorDoc> {
    const before = await itVendorRepository.getById(id);
    if (input.name !== undefined && input.name !== before.name) {
      const clash = await itVendorRepository.findByName(input.name);
      if (clash !== null) throw new ConflictError(`vendor "${input.name}" already exists`);
    }
    const set: Partial<ItVendorDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.code !== undefined) set.code = input.code;
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.email !== undefined) set.email = input.email;
    if (input.address !== undefined) set.address = input.address;
    if (input.services !== undefined) set.services = input.services;
    if (input.contacts !== undefined) set.contacts = toContacts(input.contacts);
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await itVendorRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const itVendorService = new ItVendorService();
