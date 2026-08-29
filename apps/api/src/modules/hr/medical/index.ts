// The feature's public surface (ADR-003).
export { medicalProfileService } from './profiles/medical-profile.service';
export { medicalEventService } from './events/medical-event.service';
export { insuranceCardService } from './insurance/insurance-card.service';
export {
  insuranceCardRepository,
  medicalEventRepository,
  medicalProfileRepository,
} from './medical.repository';
export { toInsuranceCardDto, toMedicalEventDto, toMedicalProfileDto } from './medical.mapper';
export {
  buildMedicalEventsRouter,
  buildMedicalInsuranceRouter,
  buildMedicalProfilesRouter,
} from './medical.routes';
export { type MedicalProfileDoc } from './profiles/medical-profile.model';
export { type MedicalEventDoc } from './events/medical-event.model';
export { type InsuranceCardDoc } from './insurance/insurance-card.model';
export {
  ensureMedicalDocumentCategory,
  hrMedicalDocumentAuthorizers,
} from './events/medical-event.files';
