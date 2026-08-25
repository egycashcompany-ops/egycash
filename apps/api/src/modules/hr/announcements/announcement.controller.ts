// Thin HTTP mapping only (ADR-003).
//
// The one thing it decides is the SCOPE it hands the service, and it is the same one for both
// routes: `employee.view`. An announcement's audience is read out of the employee registry, so
// the ceiling on who a sender can reach is exactly the ceiling on who they can SEE — a branch HR
// manager who cannot list another branch's employees cannot address them either. Deriving it from
// a second permission would let the two answers drift apart, and the direction they would drift is
// the one that reaches more people.
import { type Request, type Response } from 'express';
import {
  type CreateAnnouncement,
  type ListAnnouncementsQuery,
  type PreviewAnnouncementAudience,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { announcementService } from './announcement.service';

/** The audience ceiling: what the caller may SEE is what they may ADDRESS. */
const audienceScope = (req: Request) => scopeSelector(authContext(req), 'employee.view');

export const previewAnnouncementAudience = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<PreviewAnnouncementAudience>(req);
  ok(res, await announcementService.preview(body.audience, audienceScope(req)));
};

export const sendAnnouncement = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateAnnouncement>(req);
  const dto = await announcementService.send(body, ctx, audienceScope(req));
  created(res, dto, `/api/v1/hr/announcements/${dto.id}`);
};

export const getAudienceOptions = async (req: Request, res: Response): Promise<void> => {
  ok(res, await announcementService.audienceOptions(audienceScope(req)));
};

export const listAnnouncements = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<unknown, ListAnnouncementsQuery>(req);
  okPage(res, await announcementService.list(query), (dto) => dto);
};
