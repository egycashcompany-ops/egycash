// A software passkey for tests: a real P-256 key pair answering real WebAuthn ceremonies, so the
// server's checks run against the library's actual verification rather than a mock of it.
//
// What a phone does after the fingerprint, minus the fingerprint: `register` answers a creation
// challenge with attestation `none` (what browsers send when `none` is asked for), `authenticate`
// signs a sign-in challenge. Each ceremony can be bent one way — another origin, no user
// verification, a counter that goes backwards, a certificate chain — so the refusals can be tested.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

const coseKeyOf = (publicKey: KeyObject): Uint8Array => {
  const jwk = publicKey.export({ format: 'jwk' });
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
    ]),
  );
};

const uint32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
};

export interface CeremonyBend {
  /** The origin written into the client data (default: the expected one). */
  origin?: string;
  /** The RP ID whose hash leads the authenticator data (default: the expected one). */
  rpId?: string;
  /** Leave out the user-verified flag — a device that did not check the fingerprint. */
  noUserVerification?: boolean;
  /** Override the client-data type (`webauthn.create` / `webauthn.get`). */
  type?: string;
}

export interface RegistrationBend extends CeremonyBend {
  /** Claim another attestation format. */
  fmt?: string;
  /** Put a certificate chain in the statement (bytes need not be a real certificate). */
  x5c?: Uint8Array[];
}

export interface AuthenticationBend extends CeremonyBend {
  /** Report this counter instead of the next one. */
  counter?: number;
  /** Send this user handle instead of the one registered (null: send none). */
  userHandle?: string | null;
  /** Sign with another key — someone who has the credential id but not the device. */
  signWith?: KeyObject;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private counter = 0;
  /** The `user.id` the server gave at registration — what the device returns as the user handle. */
  userHandle: string | null = null;
  /** Synced to a cloud keychain (backup-eligible and backed up). */
  constructor(private readonly synced = true) {}

  get id(): string {
    return b64u(this.credentialId);
  }

  get privateKey(): KeyObject {
    return this.keys.privateKey;
  }

  private flags(bend: CeremonyBend, extra = 0): number {
    let flags = FLAG_UP | extra;
    if (bend.noUserVerification !== true) flags |= FLAG_UV;
    if (this.synced) flags |= FLAG_BE | FLAG_BS;
    return flags;
  }

  register(
    options: { challenge: string; rp: { id: string }; user: { id: string } },
    expectedOrigin: string,
    bend: RegistrationBend = {},
  ) {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: bend.type ?? 'webauthn.create',
        challenge: options.challenge,
        origin: bend.origin ?? expectedOrigin,
        crossOrigin: false,
      }),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(bend.rpId ?? options.rp.id),
      Buffer.from([this.flags(bend, FLAG_AT)]),
      uint32(this.counter),
      Buffer.alloc(16), // AAGUID: none
      idLength,
      this.credentialId,
      Buffer.from(coseKeyOf(this.keys.publicKey)),
    ]);
    const statement = new Map<string, Uint8Array[] | number | Uint8Array>();
    if (bend.x5c !== undefined) {
      statement.set('alg', -7);
      statement.set('sig', new Uint8Array(sign('sha256', authData, this.keys.privateKey)));
      statement.set('x5c', bend.x5c);
    }
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, Uint8Array[] | number | Uint8Array>>([
        ['fmt', bend.fmt ?? 'none'],
        ['attStmt', statement],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }

  authenticate(
    options: { challenge: string; rpId: string },
    expectedOrigin: string,
    bend: AuthenticationBend = {},
  ) {
    if (bend.counter === undefined && !this.synced) this.counter += 1;
    const counter = bend.counter ?? this.counter;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: bend.type ?? 'webauthn.get',
        challenge: options.challenge,
        origin: bend.origin ?? expectedOrigin,
        crossOrigin: false,
      }),
    );
    const authData = Buffer.concat([
      sha256(bend.rpId ?? options.rpId),
      Buffer.from([this.flags(bend)]),
      uint32(counter),
    ]);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      bend.signWith ?? this.keys.privateKey,
    );
    const userHandle = bend.userHandle === undefined ? this.userHandle : bend.userHandle;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        ...(userHandle === null ? {} : { userHandle }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }
}

/** A challenge the server never issued, shaped like one it would. */
export const strayChallenge = (): string => b64u(randomBytes(32));
