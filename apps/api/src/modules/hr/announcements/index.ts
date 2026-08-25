// Public surface of the Announcements feature.
export { buildAnnouncementsRouter } from './announcement.routes';
export { announcementService } from './announcement.service';
export { ensureAnnouncementTemplate } from './announcement.seed';
// The audience resolution, shared with the notification rules: a rule that means "everybody in
// Maadi" must resolve it exactly as a person who means the same thing.
export { audienceCriteria, recipientUserIds } from './audience-criteria';
export { sendLocalisedMessage } from './send-localised';
