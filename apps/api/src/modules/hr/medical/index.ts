// The feature's public surface (ADR-003).
export { medicalProfileService } from './profiles/medical-profile.service';
export { medicalProfileRepository } from './medical.repository';
export { toMedicalProfileDto } from './medical.mapper';
export { buildMedicalProfilesRouter } from './medical.routes';
export { type MedicalProfileDoc } from './profiles/medical-profile.model';
