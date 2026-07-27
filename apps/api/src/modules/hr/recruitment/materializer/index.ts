// Public surface of the queue materializer (I11). The HR manifest and tests import from here;
// internal files are not reached across the feature boundary (ADR-003).
export { queueMaterializerService } from './queue-materializer.service';
export {
  registerQueueMaterializer,
  resetQueueMaterializerRegistration,
} from './queue-materializer.consumers';
