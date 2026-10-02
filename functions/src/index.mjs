import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

initializeApp();

const db = getFirestore();

const CONFIRMATIONS = 'fakturaConfirmations';
const TOKENS = 'fakturaConfirmationTokens';
const LEDGERS = 'fakturaConfirmationLedgers';
const EVENTS = 'fakturaEvents';
const ORDER_LINES = 'ticketOrderLines';

const cors = [
  /^https:\/\/dolomitinordicski\.github\.io$/,
  /^http:\/\/localhost:\d+$/,
];

function send(res, status, payload) {
  res.status(status).json(payload);
}

function tokenHash(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) {
    throw new Error('TOKEN_INVALID');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function parseBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new Error('INVALID_REQUEST');
  }
  return req.body;
}

async function findTokenByHash(hash) {
  const snapshot = await db
    .collection(TOKENS)
    .where('tokenHash', '==', hash)
    .limit(2)
    .get();

  if (snapshot.empty) return null;
  if (snapshot.size > 1) throw new Error('DUPLICATE_TOKEN_HASH');
  return snapshot.docs[0];
}

function activeTokenOrThrow(token, nowMs) {
  if (
    token.active !== true ||
    token.usedAt ||
    token.revokedAt
  ) {
    throw new Error('TOKEN_NOT_ACTIVE');
  }

  if (
    typeof token.expiresAt === 'string' &&
    Number.isFinite(Date.parse(token.expiresAt)) &&
    Date.parse(token.expiresAt) <= nowMs
  ) {
    throw new Error('TOKEN_EXPIRED');
  }
}

function cleanForFirestore(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanForFirestore(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanForFirestore(item)]),
    );
  }

  return value;
}

function confirmationOrThrow(id, data) {
  const statuses = [
    'DRAFT',
    'SENT',
    'CHANGE_REQUESTED',
    'CONFIRMED',
    'SUPERSEDED',
    'VOIDED',
  ];

  if (
    !data ||
    typeof data !== 'object' ||
    !statuses.includes(data.status) ||
    !Array.isArray(data.lines) ||
    typeof data.acceptanceTextVersion !== 'string'
  ) {
    throw new Error(`INVALID_CONFIRMATION_RECORD:${id}`);
  }

  return { ...data, id };
}

function requestedResponse(confirmation, requestedQuantities) {
  if (
    !requestedQuantities ||
    typeof requestedQuantities !== 'object' ||
    Array.isArray(requestedQuantities)
  ) {
    throw new Error('INVALID_REQUESTED_QUANTITIES');
  }

  const knownIds = new Set(
    confirmation.lines.map((line) => line.orderLineId),
  );

  for (const [orderLineId, quantity] of Object.entries(requestedQuantities)) {
    if (!knownIds.has(orderLineId)) {
      throw new Error('UNKNOWN_ORDER_LINE');
    }
    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      throw new Error('INVALID_REQUESTED_QUANTITY');
    }
  }

  const requestedLines = confirmation.lines.map((line) => {
    const quantity =
      requestedQuantities[line.orderLineId] ?? line.proposedQuantity;

    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      throw new Error('INVALID_REQUESTED_QUANTITY');
    }

    return { line, quantity };
  });

  const changed = requestedLines.some(
    ({ line, quantity }) => quantity !== line.proposedQuantity,
  );

  if (changed) {
    return {
      status: 'CHANGE_REQUESTED',
      lines: requestedLines.map(({ line, quantity }) => ({
        ...line,
        requestedQuantity: quantity,
        confirmedQuantity: undefined,
      })),
    };
  }

  return {
    status: 'CONFIRMED',
    lines: requestedLines.map(({ line, quantity }) => ({
      ...line,
      requestedQuantity: undefined,
      confirmedQuantity: quantity,
    })),
  };
}

function publicView(confirmation) {
  return {
    confirmationId: confirmation.id,
    acceptanceTextVersion: confirmation.acceptanceTextVersion,
    lines: confirmation.lines.map((line) => ({
      orderLineId: line.orderLineId,
      catalogItemId: line.catalogItemId,
      proposedQuantity: line.proposedQuantity,
      unit: line.unit,
    })),
  };
}

function publicError(error) {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const known = new Set([
    'TOKEN_INVALID',
    'TOKEN_NOT_ACTIVE',
    'TOKEN_EXPIRED',
    'INVALID_REQUEST',
    'INVALID_REQUESTED_QUANTITIES',
    'INVALID_REQUESTED_QUANTITY',
    'UNKNOWN_ORDER_LINE',
    'CONFIRMATION_NOT_FOUND',
    'INVALID_CONFIRMATION_STATE',
    'ORDER_LINE_NOT_FOUND',
    'ORDER_LINE_SCOPE_MISMATCH',
    'CONFIRMATION_EXCEEDS_REMAINING',
  ]);

  if (code.startsWith('CONFIRMATION_EXCEEDS_REMAINING:')) {
    return { status: 409, code: 'CONFIRMATION_EXCEEDS_REMAINING' };
  }

  if (known.has(code)) {
    const status =
      code === 'TOKEN_NOT_ACTIVE' || code === 'TOKEN_EXPIRED'
        ? 410
        : code === 'INVALID_CONFIRMATION_STATE'
          ? 409
          : 400;
    return { status, code };
  }

  logger.error('Public confirmation endpoint failed', error);
  return { status: 500, code: 'INTERNAL_ERROR' };
}

export const resolvePublicConfirmation = onRequest(
  {
    region: 'europe-west1',
    invoker: 'public',
    cors,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }

    try {
      const body = parseBody(req);
      const hash = tokenHash(body.token);
      const tokenSnapshot = await findTokenByHash(hash);

      if (!tokenSnapshot) {
        return send(res, 410, { error: 'TOKEN_NOT_ACTIVE' });
      }

      const token = tokenSnapshot.data();
      activeTokenOrThrow(token, Date.now());

      const confirmationSnapshot = await db
        .collection(CONFIRMATIONS)
        .doc(token.confirmationId)
        .get();

      if (!confirmationSnapshot.exists) {
        throw new Error('CONFIRMATION_NOT_FOUND');
      }

      const confirmation = confirmationOrThrow(
        confirmationSnapshot.id,
        confirmationSnapshot.data(),
      );

      if (confirmation.status !== 'SENT') {
        throw new Error('INVALID_CONFIRMATION_STATE');
      }

      return send(res, 200, publicView(confirmation));
    } catch (error) {
      const failure = publicError(error);
      return send(res, failure.status, { error: failure.code });
    }
  },
);

export const submitPublicConfirmation = onRequest(
  {
    region: 'europe-west1',
    invoker: 'public',
    cors,
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }

    try {
      const body = parseBody(req);
      const hash = tokenHash(body.token);
      const actorLabel =
        typeof body.actorLabel === 'string' ? body.actorLabel.trim() : '';

      if (!actorLabel || actorLabel.length > 120) {
        throw new Error('INVALID_REQUEST');
      }

      const tokenSnapshot = await findTokenByHash(hash);
      if (!tokenSnapshot) {
        return send(res, 410, { error: 'TOKEN_NOT_ACTIVE' });
      }

      const tokenRef = tokenSnapshot.ref;
      const now = new Date();
      const nowIso = now.toISOString();

      const result = await db.runTransaction(async (transaction) => {
        const tokenFreshSnapshot = await transaction.get(tokenRef);
        if (!tokenFreshSnapshot.exists) {
          throw new Error('TOKEN_NOT_ACTIVE');
        }

        const token = tokenFreshSnapshot.data();
        activeTokenOrThrow(token, now.getTime());

        const confirmationRef = db
          .collection(CONFIRMATIONS)
          .doc(token.confirmationId);
        const confirmationSnapshot = await transaction.get(confirmationRef);

        if (!confirmationSnapshot.exists) {
          throw new Error('CONFIRMATION_NOT_FOUND');
        }

        const confirmation = confirmationOrThrow(
          confirmationSnapshot.id,
          confirmationSnapshot.data(),
        );

        if (confirmation.status !== 'SENT') {
          throw new Error('INVALID_CONFIRMATION_STATE');
        }

        const response = requestedResponse(
          confirmation,
          body.requestedQuantities,
        );

        const ledgerRef = db.collection(LEDGERS).doc(confirmation.orderId);
        const ledgerSnapshot = await transaction.get(ledgerRef);
        const ledger = ledgerSnapshot.exists
          ? ledgerSnapshot.data()
          : {
              orderId: confirmation.orderId,
              confirmedByLine: {},
              updatedAt: nowIso,
            };

        let writeLedger = false;
        if (response.status === 'CONFIRMED') {
          for (const line of response.lines) {
            const orderLineRef = db
              .collection(ORDER_LINES)
              .doc(line.orderLineId);
            const orderLineSnapshot = await transaction.get(orderLineRef);

            if (!orderLineSnapshot.exists) {
              throw new Error('ORDER_LINE_NOT_FOUND');
            }

            const orderLine = orderLineSnapshot.data();
            if (
              orderLine.ticketOrderId !== confirmation.orderId ||
              typeof orderLine.quantity !== 'number'
            ) {
              throw new Error('ORDER_LINE_SCOPE_MISMATCH');
            }

            const already =
              ledger.confirmedByLine?.[line.orderLineId] ?? 0;
            const quantity = line.confirmedQuantity ?? 0;

            if (already + quantity > orderLine.quantity) {
              throw new Error(
                `CONFIRMATION_EXCEEDS_REMAINING:${line.orderLineId}`,
              );
            }
          }

          ledger.confirmedByLine = {
            ...(ledger.confirmedByLine ?? {}),
          };
          for (const line of response.lines) {
            ledger.confirmedByLine[line.orderLineId] =
              (ledger.confirmedByLine[line.orderLineId] ?? 0) +
              (line.confirmedQuantity ?? 0);
          }
          ledger.updatedAt = nowIso;
          writeLedger = true;
        }

        const actorId = `public-confirmation-token:${tokenFreshSnapshot.id}`;
        const nextConfirmation = {
          ...confirmation,
          status: response.status,
          lines: response.lines,
          confirmedAt:
            response.status === 'CONFIRMED' ? nowIso : undefined,
          confirmedBy:
            response.status === 'CONFIRMED' ? actorLabel : undefined,
          updatedAt: nowIso,
          updatedBy: actorId,
        };

        const eventId =
          `confirmation-response:${confirmation.id}:r${confirmation.revision}`;
        const eventRef = db.collection(EVENTS).doc(eventId);
        const existingEvent = await transaction.get(eventRef);
        if (existingEvent.exists) {
          throw new Error('TOKEN_NOT_ACTIVE');
        }

        const event = {
          id: eventId,
          type:
            response.status === 'CONFIRMED'
              ? 'CONFIRMATION_CONFIRMED'
              : 'CONFIRMATION_CHANGE_REQUESTED',
          occurredAt: nowIso,
          actorId,
          actorLabel,
          seasonId: confirmation.seasonId,
          organizationId: confirmation.organizationId,
          entityType: 'CONFIRMATION',
          entityId: confirmation.id,
          entityRevision: confirmation.revision,
          payload: {
            fromStatus: 'SENT',
            toStatus: response.status,
          },
        };

        if (writeLedger) {
          transaction.set(ledgerRef, cleanForFirestore(ledger));
        }
        transaction.set(
          confirmationRef,
          cleanForFirestore(nextConfirmation),
        );
        transaction.set(
          tokenRef,
          cleanForFirestore({
            ...token,
            active: false,
            usedAt: nowIso,
          }),
        );
        transaction.set(eventRef, cleanForFirestore(event));

        return {
          confirmationId: confirmation.id,
          status: response.status,
        };
      });

      return send(res, 200, result);
    } catch (error) {
      const failure = publicError(error);
      return send(res, failure.status, { error: failure.code });
    }
  },
);
