import { createHmac } from 'crypto';
import CallRecord from '@models/calls/CallRecord';
import { serializeCall, type CallRecordJSON } from '@serializers/callSerializer';
import type { CallDirection, CallOutcome } from '@constants/enums';
import { numberEnv, optionalEnv } from '@utils/env';
import logger from '@utils/logger';

// ICE servers the app feeds to its RTCPeerConnection. STUN alone lets peers on
// the same/open network connect; a TURN relay (configured via env) is needed to
// traverse symmetric NATs. Defaults to Google's public STUN so calls work in dev
// without any TURN provider. In production the relay is coturn on the API's own
// VPS — deploy/provision.sh installs it and fills in the env below.
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const splitEnv = (key: string, fallback = ''): string[] =>
  optionalEnv(key, fallback)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// This endpoint is hit on every call setup, so the config diagnostics below
// would otherwise repeat per call. One line per process is enough to find it.
let turnConfigLogged = false;
const logTurnConfigOnce = (log: () => void): void => {
  if (turnConfigLogged) return;
  turnConfigLogged = true;
  log();
};

/** Test seam — the once-flag is per process, and each test file is its own. */
export const __resetTurnConfigLog = (): void => {
  turnConfigLogged = false;
};

// 12 hours. The floor is "longer than any call": coturn checks the embedded
// expiry when an allocation is *created*, and the app fetches this list once per
// call setup, so a short TTL buys nothing while risking a credential that dies
// between the fetch and a reconnect mid-call. The ceiling is "short enough that
// a credential scraped off a device is not a standing grant of free relay
// bandwidth" — a stolen one is dead by tomorrow, and it is scoped to one user
// id, so `user-quota` in turnserver.conf bounds what it can consume meanwhile.
const TURN_TTL_DEFAULT_SECONDS = 12 * 60 * 60;

const turnTtlSeconds = (): number => {
  const ttl = numberEnv('TURN_CREDENTIAL_TTL_SECONDS', TURN_TTL_DEFAULT_SECONDS);
  // A non-positive TTL mints a credential that is already expired — every
  // allocation would be refused by a relay that looks configured. Refuse the
  // value, not the feature.
  return ttl > 0 ? Math.floor(ttl) : TURN_TTL_DEFAULT_SECONDS;
};

/**
 * coturn's `use-auth-secret` (REST API) credential. Nothing is stored on either
 * side: the username carries its own expiry and the password is an HMAC the
 * relay recomputes from the same shared secret.
 *
 *   username   = <unix-expiry>:<userId>
 *   credential = base64(HMAC-SHA1(username, static_auth_secret))
 *
 * Why this rather than a fixed username/password: a static TURN credential
 * shipped inside a mobile binary is trivially extracted, and it never expires —
 * whoever pulls it gets an open relay running on our bandwidth. This one dies on
 * a timer and names the user who was issued it, so abuse is attributable and
 * quota-limited. The secret itself never leaves the server.
 */
export const mintTurnCredential = (
  secret: string,
  userId: string,
  ttlSeconds: number
): { username: string; credential: string } => {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  return {
    username,
    credential: createHmac('sha1', secret).update(username).digest('base64'),
  };
};

export const getIceServers = (userId: string): { ice_servers: IceServer[] } => {
  const ice_servers: IceServer[] = [];

  const stun = splitEnv('STUN_URLS', 'stun:stun.l.google.com:19302');
  if (stun.length > 0) ice_servers.push({ urls: stun });

  const turn = splitEnv('TURN_URLS');
  const secret = optionalEnv('TURN_STATIC_AUTH_SECRET');
  const username = optionalEnv('TURN_USERNAME');
  const credential = optionalEnv('TURN_CREDENTIAL');

  if (turn.length === 0) {
    // Not an error — STUN-only is the correct dev default — but it is the
    // single most likely reason a real-world call "rings and never connects",
    // so it must not be silent. Two phones on mobile data sit behind
    // symmetric NAT/CGNAT and cannot reach each other without a relay.
    logTurnConfigOnce(() =>
      logger.warn(
        'calls: TURN_URLS unset — serving STUN only. Peers behind symmetric NAT/CGNAT (typical mobile data) will not connect. Set TURN_URLS + TURN_STATIC_AUTH_SECRET (deploy/provision.sh provisions coturn on this box and fills both in) to enable relaying.'
      )
    );
    return { ice_servers };
  }

  // The relay we provision ourselves (deploy/provision.sh → coturn with
  // `use-auth-secret`). Credentials are computed per request and expire, so
  // there is nothing long-lived to leak through the app binary. This branch
  // wins over TURN_USERNAME/TURN_CREDENTIAL when both are somehow set: it is
  // strictly the safer of the two, and silently preferring the weaker one
  // because it happens to be listed second would be a trap.
  if (secret) {
    const ttl = turnTtlSeconds();
    // The one branch where everything is right, said once so an operator can
    // confirm it from the log instead of inferring it from the absence of a
    // warning.
    logTurnConfigOnce(() =>
      logger.info(
        `calls: TURN relaying enabled — minting per-user credentials valid ${ttl}s against ${turn.length} relay URL(s).`
      )
    );
    ice_servers.push({
      urls: turn,
      ...mintTurnCredential(secret, userId, ttl),
    });
    return { ice_servers };
  }

  // `optionalEnv` returns '' for an unset key, and an empty username/credential
  // is not "no auth" — it authenticates AS empty strings, so every allocation
  // is refused and the relay silently contributes nothing. A half-configured
  // TURN server is worse than none: it looks configured. Refuse it, loudly.
  if (!username || !credential) {
    logTurnConfigOnce(() =>
      logger.error(
        'calls: TURN_URLS is set but TURN_STATIC_AUTH_SECRET and TURN_USERNAME/TURN_CREDENTIAL are all empty — the relay is omitted from ice_servers. Set TURN_STATIC_AUTH_SECRET (preferred), or both static credentials, or unset TURN_URLS.'
      )
    );
    return { ice_servers };
  }

  // Static credentials still work — a hosted provider may only offer them — but
  // every client gets the same never-expiring pair, so anyone who pulls it out
  // of the app binary has a permanent free relay on our bandwidth.
  logTurnConfigOnce(() =>
    logger.warn(
      'calls: serving a STATIC TURN credential. It never expires and is identical for every user, so extracting it from the app binary yields an open relay. Prefer TURN_STATIC_AUTH_SECRET (time-limited, per-user) where the relay supports it.'
    )
  );

  ice_servers.push({ urls: turn, username, credential });
  return { ice_servers };
};

// Request-body shape, so snake_case like every other field on the wire (see
// validators/callValidators.ts). It happens to match CallPeerJSON exactly, which
// is the point: the client hands a history row's peer straight back to ring
// them again, with no remapping in either direction.
interface CallPeerInput {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface CallRecordInputData {
  /** The other side of a 1:1 call; null for a group. */
  peer: CallPeerInput | null;
  is_group: boolean;
  /** Everyone rung, excluding me. Empty for a 1:1. */
  participants: CallPeerInput[];
  direction: CallDirection;
  is_video: boolean;
  outcome: CallOutcome;
  started_at: string;
  duration_sec: number;
}

/**
 * Call history — server state (shared across a user's devices), 1:1 and group.
 *
 * Scoped to `owner_id`, which IS the ownership check: a user's log is only ever
 * reachable through their own token, so there is nothing to leak cross-user.
 * One indexed query, no join — the participant snapshots ride inline on the row
 * (see the model), which is why this read path didn't grow when groups landed.
 */
export const listCalls = async (
  ownerId: string
): Promise<{ items: CallRecordJSON[] }> => {
  const records = await CallRecord.findAll({
    where: { owner_id: ownerId },
    order: [['started_at', 'DESC']],
    limit: 100,
  });
  return { items: records.map(serializeCall) };
};

export const recordCall = async (
  ownerId: string,
  input: CallRecordInputData
): Promise<CallRecordJSON> => {
  // Freeze the roster at write time — the same reason peer_username/avatar are
  // stored inline rather than joined: this row must not drift when someone
  // later renames or changes their avatar.
  const record = await CallRecord.create({
    owner_id: ownerId,
    peer_id: input.peer?.id ?? null,
    peer_username: input.peer?.username ?? null,
    peer_avatar_url: input.peer?.avatar_url ?? null,
    is_group: input.is_group,
    participants: input.is_group
      ? input.participants.map(p => ({
          id: p.id,
          username: p.username,
          avatar_url: p.avatar_url,
        }))
      : [],
    direction: input.direction,
    is_video: input.is_video,
    outcome: input.outcome,
    started_at: new Date(input.started_at),
    duration_sec: input.duration_sec,
  });
  return serializeCall(record);
};
