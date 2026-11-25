// The supplier records the screen specs read (P1b.W), as the API answers them — beside the module's
// `screen-fixtures.tsx`, which holds the reader, the renderer and the catalog records. Imported by
// specs only. The names and numbers are invented: the repository is public.
import {
  type AdministrationSupplierAttachmentDto,
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
} from '@ecms/contracts';

const STAMP = '2026-11-25T09:00:00.000Z';

export const supplier = (
  over: Partial<AdministrationSupplierDto> = {},
): AdministrationSupplierDto => ({
  id: 's-1',
  code: 'SUP-00001',
  name: { ar: 'شركة النور للأدوات المكتبية', en: 'Al Nour Office Supplies' },
  phone: '01012345678',
  email: 'sales@alnour.example',
  address: 'شارع التحرير، القاهرة',
  contacts: [
    {
      name: 'هشام فؤاد',
      role: 'مدير المبيعات',
      phone: '01198765432',
      email: 'hesham@alnour.example',
    },
  ],
  categories: [
    { id: 'c-ink', name: { ar: 'الأحبار', en: 'Inks' } },
    { id: 'c-paper', name: { ar: 'الورق', en: 'Paper' } },
  ],
  taxNumber: '123-456-789',
  commercialRegistry: '98765',
  vatStatus: null,
  paymentTerms: 'آجل ٣٠ يومًا',
  notes: null,
  isActive: true,
  version: 4,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

export const paper = (
  over: Partial<AdministrationSupplierAttachmentDto> = {},
): AdministrationSupplierAttachmentDto => ({
  attachmentId: 'a-1',
  categoryKey: 'administration-supplier-documents',
  label: 'السجل التجاري',
  fileName: 'registry.pdf',
  mime: 'application/pdf',
  size: 245_760,
  addedByUserId: 'u-1',
  addedAt: STAMP,
  scanStatus: 'clean',
  ...over,
});

export const supplierDetail = (
  over: Partial<AdministrationSupplierDetailDto> = {},
): AdministrationSupplierDetailDto => ({
  ...supplier(),
  attachments: [paper()],
  taxNumberMatches: [],
  ...over,
});
