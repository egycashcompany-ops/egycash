// Job places (P-ORG-3): a job title's places in the company structure. See `job-place.model.ts`.
export { JobPlaceModel, type JobPlaceDoc } from './job-place.model';
export { JobPlaceFillModel, type JobPlaceFillDoc } from './job-place-fill.model';
export { migrateJobPlaceIndexes } from './job-place-indexes';
export { jobPlaceRepository, placeKey, type PlaceKey } from './job-place.repository';
