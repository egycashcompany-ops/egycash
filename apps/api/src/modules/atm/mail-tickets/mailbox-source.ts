// Which mailbox one run of the reader reads — asked per run, so a save on /atm/settings takes
// effect on the next minute without a restart.
//
//   no document         → the deployment's environment, EXACTLY as before the screen existed: the
//                         source registered at boot (or none), every branch, the old category
//                         setting. Having a document is what ends this mode.
//   disabled document   → nothing at all: «تفعيل القراءة» is off, the environment included.
//   enabled document    → the mailbox it names, through the registered provider, filing only the
//                         branches it switches on (the owner: «هنبدأ بفرع المهندسين حالياً
//                         وبعدين هنبقى نزود فرع فرع»).
//
// The document's source is built once and kept until the document's version changes — any save —
// so the provider's cached token survives from one minute's run to the next instead of a token
// request a minute.
import { getSecretStore } from '../../../platform/secrets';
import {
  getAtmMailSource,
  getAtmMailSourceFactory,
  type AtmMailSource,
  type AtmMailSourceFactory,
} from './mail-source';
import { type AtmMailboxConfigDoc } from './mailbox-config.model';
import { atmMailboxConfigRepository } from './mailbox-config.repository';

/** The AAD context the client secret is sealed under: the record and the field (platform/crypto). */
export const mailboxSecretContext = (id: string): string => `atm_mailbox_config:${id}:clientSecret`;

export type AtmMailPollPlan =
  | { mode: 'environment'; source: AtmMailSource }
  | { mode: 'off' }
  | { mode: 'mailbox'; doc: AtmMailboxConfigDoc };

export const resolveAtmMailPollPlan = async (): Promise<AtmMailPollPlan> => {
  const doc = await atmMailboxConfigRepository.findSingleton();
  if (doc === null) return { mode: 'environment', source: getAtmMailSource() };
  if (!doc.enabled) return { mode: 'off' };
  return { mode: 'mailbox', doc };
};

/**
 * A NEW source for a document. Throws, naming the reason, when it cannot be read from at all; the
 * secret is opened only when the provider asks for a token, never here.
 */
export const buildMailboxSource = (doc: AtmMailboxConfigDoc): AtmMailSource => {
  const ref = doc.clientSecretRef;
  if (ref === null) throw new Error('no client secret is stored');
  const factory = getAtmMailSourceFactory();
  if (factory === null) throw new Error('no mail provider is registered');
  const id = String(doc._id);
  return factory({
    tenantId: doc.tenantId,
    clientId: doc.clientId,
    userEmail: doc.userEmail,
    openSecret: () => getSecretStore().open(ref, mailboxSecretContext(id)),
  });
};

let cached: {
  id: string;
  version: number;
  factory: AtmMailSourceFactory | null;
  source: AtmMailSource;
} | null = null;

/** The document's source, rebuilt only when the document (or the registered provider) changed. */
export const mailboxSourceFor = (doc: AtmMailboxConfigDoc): AtmMailSource => {
  const id = String(doc._id);
  const factory = getAtmMailSourceFactory();
  if (cached?.id === id && cached.version === doc.__v && cached.factory === factory) {
    return cached.source;
  }
  const source = buildMailboxSource(doc);
  cached = { id, version: doc.__v, factory, source };
  return source;
};
