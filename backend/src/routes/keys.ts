import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';

interface UploadBody {
  device_keys?: Prisma.InputJsonValue;
  one_time_keys?: Record<string, Prisma.InputJsonValue>;
  fallback_keys?: Prisma.InputJsonValue;
}

interface QueryBody {
  device_keys?: Record<string, string[]>;
}

interface ClaimBody {
  one_time_keys?: Record<string, Record<string, string>>;
}

interface SigningKeysUploadBody {
  master_key?: Prisma.InputJsonValue;
  self_signing_key?: Prisma.InputJsonValue;
  user_signing_key?: Prisma.InputJsonValue;
}

// Shape of a signed key object (device_keys or a cross-signing key) as far
// as the merge below cares — everything except `signatures` is opaque.
interface SignedKeyObject {
  signatures?: Record<string, Record<string, string>>;
  [key: string]: unknown;
}

/**
 * Unions `signatures[signerUserId]` entries from `incoming` into `existing`,
 * keeping every other field from `incoming` (the caller's client always
 * sends the full up-to-date object). New signer/keyId entries win on
 * conflict; nothing is dropped.
 *
 * Confirmed necessary by a live grounding script (see
 * docs/crypto-integration-notes.md's cross-signing section) — a plain
 * overwrite of the stored object with `incoming` drops whatever signatures
 * were already there (e.g. a device's own self-signature), which silently
 * corrupts the device/key record for every future viewer.
 */
function mergeSignatures(existing: SignedKeyObject | null | undefined, incoming: SignedKeyObject): SignedKeyObject {
  const merged: SignedKeyObject = { ...incoming, signatures: { ...(incoming.signatures ?? {}) } };
  if (existing?.signatures) {
    for (const [signerUserId, sigEntries] of Object.entries(existing.signatures)) {
      merged.signatures![signerUserId] = { ...sigEntries, ...(merged.signatures![signerUserId] ?? {}) };
    }
  }
  return merged;
}

// POST /keys/upload, /keys/query, /keys/claim, /keys/signing-keys/upload,
// /keys/signatures/upload — see docs/api/openapi.yaml and
// docs/crypto-integration-notes.md. These exist to satisfy
// matrix-sdk-crypto-wasm's OlmMachine.outgoingRequests() shapes (real Matrix
// Client-Server API request/response bodies), not because CyCove talks to a
// real Matrix homeserver — the server stores/serves these blobs opaquely
// (with the one exception of /keys/signatures/upload, which has to merge —
// see mergeSignatures above).
export async function keyRoutes(app: FastifyInstance) {
  app.post<{ Body: UploadBody }>('/keys/upload', { preHandler: requireAuth }, async (request, reply) => {
    const { device_keys, one_time_keys } = request.body ?? {};
    const deviceId = request.deviceId!;

    if (device_keys) {
      await prisma.device.update({ where: { id: deviceId }, data: { deviceKeys: device_keys } });
    }

    if (one_time_keys) {
      const entries = Object.entries(one_time_keys);
      if (entries.length > 0) {
        await prisma.oneTimeKey.createMany({
          data: entries.map(([keyId, keyData]) => ({ deviceId, keyId, keyData })),
          skipDuplicates: true,
        });
      }
    }

    const remaining = await prisma.oneTimeKey.count({ where: { deviceId, consumedAt: null } });
    return reply.send({ one_time_key_counts: { signed_curve25519: remaining } });
  });

  app.post<{ Body: QueryBody }>('/keys/query', { preHandler: requireAuth }, async (request, reply) => {
    const requested = request.body?.device_keys ?? {};
    const deviceKeysResponse: Record<string, Record<string, unknown>> = {};
    const masterKeysResponse: Record<string, unknown> = {};
    const selfSigningKeysResponse: Record<string, unknown> = {};
    const userSigningKeysResponse: Record<string, unknown> = {};

    const caller = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

    for (const [userId, deviceIds] of Object.entries(requested)) {
      const devices = await prisma.device.findMany({
        where: {
          userId,
          ...(deviceIds.length > 0 ? { id: { in: deviceIds } } : {}),
        },
      });
      deviceKeysResponse[userId] = Object.fromEntries(devices.map((d) => [d.id, d.deviceKeys]));

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { masterKey: true, selfSigningKey: true, userSigningKey: true },
      });
      if (user?.masterKey) masterKeysResponse[userId] = user.masterKey;
      if (user?.selfSigningKey) selfSigningKeysResponse[userId] = user.selfSigningKey;
      // user_signing_key is only meaningful to its own owner (it's the key
      // *you* use to sign other people's identities) — matches real
      // Matrix's convention of only returning it for the caller's own user_id.
      if (userId === caller.userId && user?.userSigningKey) userSigningKeysResponse[userId] = user.userSigningKey;
    }

    return reply.send({
      device_keys: deviceKeysResponse,
      master_keys: masterKeysResponse,
      self_signing_keys: selfSigningKeysResponse,
      user_signing_keys: userSigningKeysResponse,
      failures: {},
    });
  });

  app.post<{ Body: ClaimBody }>('/keys/claim', { preHandler: requireAuth }, async (request, reply) => {
    const requested = request.body?.one_time_keys ?? {};
    const claimedResponse: Record<string, Record<string, Record<string, unknown>>> = {};

    for (const [userId, devices] of Object.entries(requested)) {
      claimedResponse[userId] = {};
      for (const deviceId of Object.keys(devices)) {
        // Same atomic claim-and-consume pattern as the original /prekeys
        // endpoint: updateMany's WHERE (id + consumedAt: null) only matches
        // if no concurrent claim already took it, so two simultaneous
        // requests can't both walk away with the same one-time key.
        const claimed = await prisma.$transaction(async (tx) => {
          const candidate = await tx.oneTimeKey.findFirst({
            where: { deviceId, consumedAt: null },
            orderBy: { id: 'asc' },
          });
          if (!candidate) return null;

          const result = await tx.oneTimeKey.updateMany({
            where: { id: candidate.id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
          return result.count > 0 ? candidate : null;
        });

        if (claimed) {
          claimedResponse[userId]![deviceId] = { [claimed.keyId]: claimed.keyData };
        }
      }
    }

    return reply.send({ one_time_keys: claimedResponse });
  });

  // Bootstrap step 2 (of 3) — see docs/crypto-integration-notes.md. Opaque
  // write, same pass-through pattern as /keys/upload's device_keys.
  app.post<{ Body: SigningKeysUploadBody }>('/keys/signing-keys/upload', { preHandler: requireAuth }, async (request, reply) => {
    const { master_key, self_signing_key, user_signing_key } = request.body ?? {};
    const caller = await prisma.device.findUniqueOrThrow({ where: { id: request.deviceId! } });

    await prisma.user.update({
      where: { id: caller.userId },
      data: {
        ...(master_key !== undefined ? { masterKey: master_key } : {}),
        ...(self_signing_key !== undefined ? { selfSigningKey: self_signing_key } : {}),
        ...(user_signing_key !== undefined ? { userSigningKey: user_signing_key } : {}),
      },
    });

    return reply.code(204).send();
  });

  // Bootstrap step 3 (of 3), and also used ad hoc whenever a device or
  // identity gets signed later (linking a new device, cross-signing a
  // contact after SAS). Body shape: {"<user_id>": {"<device_id_or_pubkey>":
  // <signed key object>}}. The target user_id is often NOT the caller (e.g.
  // Bob uploading a signature over Alice's master key after verifying her)
  // — that's expected, this is exactly what cross-signing another identity
  // produces. The server doesn't verify signature validity itself (same
  // "dumb pipe" philosophy as everywhere else) — a bad signature just fails
  // client-side verification for whoever fetches it back.
  app.post<{ Body: Record<string, Record<string, SignedKeyObject>> }>(
    '/keys/signatures/upload',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body ?? {};
      const failures: Record<string, Record<string, unknown>> = {};

      for (const [userId, keys] of Object.entries(body)) {
        for (const [keyId, signedObject] of Object.entries(keys)) {
          const device = await prisma.device.findUnique({ where: { id: keyId } });
          if (device && device.userId === userId) {
            const merged = mergeSignatures(device.deviceKeys as SignedKeyObject, signedObject);
            await prisma.device.update({ where: { id: device.id }, data: { deviceKeys: merged as Prisma.InputJsonValue } });
            continue;
          }

          const user = await prisma.user.findUnique({ where: { id: userId }, select: { masterKey: true } });
          const masterKey = user?.masterKey as SignedKeyObject & { keys?: Record<string, string> } | null;
          if (masterKey?.keys && Object.values(masterKey.keys).includes(keyId)) {
            const merged = mergeSignatures(masterKey, signedObject);
            await prisma.user.update({ where: { id: userId }, data: { masterKey: merged as Prisma.InputJsonValue } });
            continue;
          }

          failures[userId] = failures[userId] ?? {};
          failures[userId]![keyId] = { error: 'Unknown target for signature upload' };
        }
      }

      return reply.send({ failures });
    },
  );
}
