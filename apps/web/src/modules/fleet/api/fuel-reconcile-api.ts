// «مطابقة أرصدة الكروت» api/ surface (ADR-013): one typed function per endpoint.
//   POST /fleet/fuel-cards/reconcile                 multipart `company` + `file` (+ the optional
//                                                    `sheetDate`, YYYY-MM-DD) → the stored session
//                                                    and its comparison; nothing written
//   POST /fleet/fuel-cards/reconcile/:id/decisions   ✓ / ✗ on chosen cards of that session (a ✓ may
//                                                    cancel charges or approve a pending request)
//   POST /fleet/fuel-cards/reconcile/:id/links       ✓ «تحديث» / ✗ «إبقاء» on the sheet's car links
//   POST /fleet/fuel-cards/reconcile/:id/cards       «إضافة» a card the sheet has and the system lacks
import {
  type AddFleetFuelSheetCard,
  type DecideFleetFuelLinks,
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { post, upload } from '../../../shared/lib/api-client';

const sessionPath = (id: string, what: string): string =>
  `/fleet/fuel-cards/reconcile/${encodeURIComponent(id)}/${what}`;

/** `sheetDate` — «تاريخ الشيت», YYYY-MM-DD; sent only when given. */
export const uploadFuelSheet = (
  company: FleetFuelCardCompany,
  file: File,
  sheetDate?: string,
): Promise<FleetFuelReconcileDto> => {
  const form = new FormData();
  form.append('company', company);
  if (sheetDate !== undefined && sheetDate !== '') form.append('sheetDate', sheetDate);
  form.append('file', file);
  return upload<FleetFuelReconcileDto>('/fleet/fuel-cards/reconcile', form);
};

export const decideFuelReconcile = (
  id: string,
  body: DecideFleetFuelReconcile,
): Promise<FleetFuelReconcileResultDto[]> =>
  post<FleetFuelReconcileResultDto[]>(sessionPath(id, 'decisions'), body);

export const decideFuelLinks = (
  id: string,
  body: DecideFleetFuelLinks,
): Promise<FleetFuelLinkResultDto[]> =>
  post<FleetFuelLinkResultDto[]>(sessionPath(id, 'links'), body);

export const addSheetCard = (id: string, body: AddFleetFuelSheetCard): Promise<FleetFuelCardDto> =>
  post<FleetFuelCardDto>(sessionPath(id, 'cards'), body);
