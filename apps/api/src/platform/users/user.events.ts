// Typed event names + payloads this feature emits (naming per ADR-008).
export { PlatformEvents } from '@ecms/contracts';

export interface UserEventPayload {
  userId: string;
  email: string;
  status: string;
}
