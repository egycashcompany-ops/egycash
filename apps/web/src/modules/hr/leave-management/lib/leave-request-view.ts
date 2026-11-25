// What the leave request page shows of a request's approval (leave design §16.2 item 7, PXQ-1):
// pure, so a spec proves each condition without a browser.
//
//   • THE DECISION is offered from the trail's flags only while the chain decides the request.
//     Off the chain leave clears those flags, so a request the chain handed to HR's step is
//     offered its decision as any manager and HR request is: to anybody who can open it pending,
//     the server deciding who may take it.
//   • THE MANAGER AND HR CARD is drawn on a request with no trail, and beside the trail once HR's
//     step exists, waiting or decided. A request on the chain, or one that left it with no HR step,
//     shows the chain alone.
//   • ITS HEADING AND LINE say "HR step" and why on a handed-over request, so the card and the
//     chain panel beside it never share the title "Approval chain".
import { type LeaveRequestDto } from '@ecms/contracts';

const isPending = (status: LeaveRequestDto['status']): boolean =>
  status === 'pendingManager' || status === 'pendingHr' || status === 'pendingApproval';

/** Whether the page header offers Approve and Reject: the trail's flags only while the chain decides. */
export const mayDecideOn = (request: LeaveRequestDto): boolean =>
  request.status === 'pendingApproval' && request.approvalTrail !== null
    ? request.approvalTrail.viewerMayDecide || request.approvalTrail.viewerMayOverride
    : isPending(request.status);

/** Whether the manager and HR card is drawn: with no trail, and beside the trail once HR's step exists. */
export const showsDeskCard = (request: LeaveRequestDto): boolean =>
  request.approvalTrail === null || request.approvals.length > 0 || request.pendingStep !== null;

/** Whether the card is a handed-over request's HR step: its own heading and the line that says why. */
export const showsHandedToHr = (request: LeaveRequestDto): boolean =>
  request.approvalTrail !== null && showsDeskCard(request);
