// Registers the two built-in channel adapters (Sprint 3.3 plan §1/§2) at boot — both
// the api and worker processes call `bootPlatform()`, and both need the registry
// populated: the api process runs the in-app adapter synchronously inside `notify()`;
// the worker runs the email adapter from the `notifications.deliver` job handler.
import { registerChannelAdapter } from './channel-adapters/channel-adapter';
import { inAppChannelAdapter } from './channel-adapters/in-app.adapter';
import { emailChannelAdapter } from './channel-adapters/email.adapter';

export const registerBuiltinChannelAdapters = (): void => {
  registerChannelAdapter(inAppChannelAdapter);
  registerChannelAdapter(emailChannelAdapter);
};
