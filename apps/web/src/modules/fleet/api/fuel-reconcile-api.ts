// «مطابقة أرصدة الكروت» api/ surface (ADR-013): one typed function per endpoint.
//   POST /fleet/fuel-cards/reconcile                 multipart `company` + `file` → the stored
//                                                    session and its comparison; nothing written
//   POST /fleet/fuel-cards/reconcile/:id/decisions   ✓ / ✗ on chosen cards of that session
import {
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { post, upload } from '../../../shared/lib/api-client';

export const uploadFuelSheet = (
  company: FleetFuelCardCompany,
  file: File,
): Promise<FleetFuelReconcileDto> => {
  const form = new FormData();
  form.append('company', company);
  form.append('file', file);
  return upload<FleetFuelReconcileDto>('/fleet/fuel-cards/reconcile', form);
};

export const decideFuelReconcile = (
  id: string,
  body: DecideFleetFuelReconcile,
): Promise<FleetFuelReconcileResultDto[]> =>
  post<FleetFuelReconcileResultDto[]>(
    `/fleet/fuel-cards/reconcile/${encodeURIComponent(id)}/decisions`,
    body,
  );
