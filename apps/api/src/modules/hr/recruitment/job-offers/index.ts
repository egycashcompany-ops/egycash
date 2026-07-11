// Public surface of the Job Offers feature (Stage 4). The HR manifest and tests import from
// here; internal files are not reached across the feature boundary.
export { buildJobOffersRouter } from './job-offer.routes';
export { jobOfferService } from './job-offer.service';
export { type JobOfferDoc } from './job-offer.model';
