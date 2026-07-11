// Public surface of the Screening feature (Sprint 4.2, Stage 2). The HR manifest and
// tests import from here; internal files are not reached across the feature boundary.
export { buildScreeningsRouter } from './screening.routes';
export { screeningService } from './screening.service';
export { type ScreeningDoc } from './screening.model';
