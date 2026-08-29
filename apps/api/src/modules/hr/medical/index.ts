// The feature's public surface (ADR-003).
export { medicalProfileService } from './profiles/medical-profile.service';
export { medicalEventService } from './events/medical-event.service';
export { medicalEventRepository, medicalProfileRepository } from './medical.repository';
export { toMedicalEventDto, toMedicalProfileDto } from './medical.mapper';
export { buildMedicalEventsRouter, buildMedicalProfilesRouter } from './medical.routes';
export { type MedicalProfileDoc } from './profiles/medical-profile.model';
export { type MedicalEventDoc } from './events/medical-event.model';
export {
  ensureMedicalDocumentCategory,
  hrMedicalDocumentAuthorizers,
} from './events/medical-event.files';
