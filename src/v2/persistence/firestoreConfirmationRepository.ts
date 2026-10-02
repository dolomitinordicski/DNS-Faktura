import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  ConfirmationDispatchRepository,
  ConfirmationRecord,
  ConfirmationRepository,
  ConfirmationTokenAdminRepository,
  PublicConfirmationTokenRecord,
} from '../contracts/persistence';
import { fakturaV2CoreDb } from '../adapters/firebaseBackends';
import {
  approveRequestedChanges,
  approveReplacementRevisionAtomically,
  markConfirmationSent,
  receiveConfirmationResponse,
} from '../engine/confirmationEngine';
import { createDomainEvent } from '../domain/events';

const CONFIRMATIONS = 'fakturaConfirmations';
const TOKENS = 'fakturaConfirmationTokens';
const LEDGERS = 'fakturaConfirmationLedgers';
const EVENTS = 'fakturaEvents';
const ORDER_LINES = 'ticketOrderLines';

interface ConfirmationLedger {
  orderId: string;
  confirmedByLine: Record<string, number>;
  updatedAt: string;
}

function confirmationFromData(
  id: string,
  data: Record<string, unknown>,
): ConfirmationRecord {
  if (
    typeof data.seasonId !== 'string' ||
    typeof data.organizationId !== 'string' ||
    typeof data.orderId !== 'string' ||
    typeof data.revision !== 'number' ||
    !Array.isArray(data.lines) ||
    typeof data.acceptanceTextVersion !== 'string' ||
    typeof data.createdAt !== 'string' ||
    typeof data.createdBy !== 'string'
  ) {
    throw new Error(`INVALID_CONFIRMATION_RECORD:${id}`);
  }
  return { ...(data as unknown as ConfirmationRecord), id };
}

function tokenFromData(
  id: string,
  data: Record<string, unknown>,
): PublicConfirmationTokenRecord {
  if (
    typeof data.confirmationId !== 'string' ||
    typeof data.tokenHash !== 'string' ||
    typeof data.active !== 'boolean' ||
    typeof data.createdAt !== 'string'
  ) {
    throw new Error(`INVALID_CONFIRMATION_TOKEN:${id}`);
  }
  return { ...(data as unknown as PublicConfirmationTokenRecord), id };
}

function cleanForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanForFirestore(item))
      .filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanForFirestore(item)]),
    ) as T;
  }
  return value;
}

function quantityForLine(
  confirmation: ConfirmationRecord,
  orderLineId: string,
) {
  const line = confirmation.lines.find(
    (candidate) => candidate.orderLineId === orderLineId,
  );
  return (
    line?.confirmedQuantity ??
    line?.requestedQuantity ??
    line?.proposedQuantity ??
    0
  );
}

export class FirestoreConfirmationRepository
  implements ConfirmationRepository
{
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async getById(id: string): Promise<ConfirmationRecord | null> {
    const snapshot = await getDoc(doc(this.db, CONFIRMATIONS, id));
    if (!snapshot.exists()) return null;
    return confirmationFromData(snapshot.id, snapshot.data());
  }

  async listActiveByOrder(orderId: string): Promise<ConfirmationRecord[]> {
    const snapshot = await getDocs(
      query(collection(this.db, CONFIRMATIONS), where('orderId', '==', orderId)),
    );
    return snapshot.docs
      .map((item) => confirmationFromData(item.id, item.data()))
      .filter(
        (item) =>
          item.status !== 'SUPERSEDED' &&
          item.status !== 'VOIDED',
      )
      .sort((a, b) => a.revision - b.revision);
  }

  async createDraft(record: ConfirmationRecord): Promise<void> {
    if (record.status !== 'DRAFT') throw new Error('ONLY_DRAFT_CAN_BE_CREATED');

    const ref = doc(this.db, CONFIRMATIONS, record.id);
    await runTransaction(this.db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) throw new Error('CONFIRMATION_ALREADY_EXISTS');

      const event = createDomainEvent({
        id: `confirmation-created:${record.id}`,
        type: 'CONFIRMATION_CREATED',
        occurredAt: record.createdAt,
        actorId: record.createdBy,
        seasonId: record.seasonId,
        organizationId: record.organizationId,
        entityType: 'CONFIRMATION',
        entityId: record.id,
        entityRevision: record.revision,
        payload: { toStatus: 'DRAFT' },
      });
      const eventRef = doc(this.db, EVENTS, event.id);
      const priorEvent = await transaction.get(eventRef);
      if (priorEvent.exists()) throw new Error('DUPLICATE_EVENT_ID');

      transaction.set(ref, cleanForFirestore(record));
      transaction.set(eventRef, cleanForFirestore(event));
    });
  }

  async confirmTransaction(input: {
    confirmationId: string;
    actorId: string;
    occurredAt: string;
  }): Promise<ConfirmationRecord> {
    const confirmationRef = doc(this.db, CONFIRMATIONS, input.confirmationId);

    return runTransaction(this.db, async (transaction) => {
      const snapshot = await transaction.get(confirmationRef);
      if (!snapshot.exists()) throw new Error('CONFIRMATION_NOT_FOUND');

      const current = confirmationFromData(snapshot.id, snapshot.data());
      if (current.status !== 'CHANGE_REQUESTED') {
        throw new Error('INVALID_CONFIRMATION_STATE');
      }

      const ledgerRef = doc(this.db, LEDGERS, current.orderId);
      const ledgerSnapshot = await transaction.get(ledgerRef);
      const ledger: ConfirmationLedger = ledgerSnapshot.exists()
        ? (ledgerSnapshot.data() as ConfirmationLedger)
        : {
            orderId: current.orderId,
            confirmedByLine: {},
            updatedAt: input.occurredAt,
          };

      const originalRef = current.supersedesConfirmationId
        ? doc(this.db, CONFIRMATIONS, current.supersedesConfirmationId)
        : null;
      const originalSnapshot = originalRef
        ? await transaction.get(originalRef)
        : null;
      const original =
        originalSnapshot?.exists()
          ? confirmationFromData(
              originalSnapshot.id,
              originalSnapshot.data(),
            )
          : null;

      if (current.supersedesConfirmationId && !original) {
        throw new Error('ORIGINAL_CONFIRMATION_NOT_FOUND');
      }
      if (original && original.status !== 'CONFIRMED') {
        throw new Error('ORIGINAL_NOT_CONFIRMED');
      }

      const lineIds = new Set([
        ...current.lines.map((line) => line.orderLineId),
        ...(original?.lines.map((line) => line.orderLineId) ?? []),
      ]);
      const orderLineQuantities = new Map<string, number>();

      for (const orderLineId of lineIds) {
        const orderLineSnapshot = await transaction.get(
          doc(this.db, ORDER_LINES, orderLineId),
        );
        if (!orderLineSnapshot.exists()) throw new Error('ORDER_LINE_NOT_FOUND');

        const orderLine = orderLineSnapshot.data() as Record<string, unknown>;
        if (
          orderLine.ticketOrderId !== current.orderId ||
          typeof orderLine.quantity !== 'number'
        ) {
          throw new Error('ORDER_LINE_SCOPE_MISMATCH');
        }

        orderLineQuantities.set(orderLineId, orderLine.quantity);
      }

      if (original) {
        if (
          current.supersedesConfirmationId !== original.id ||
          current.revision !== original.revision + 1 ||
          current.orderId !== original.orderId ||
          current.organizationId !== original.organizationId ||
          current.seasonId !== original.seasonId
        ) {
          throw new Error('INVALID_REPLACEMENT_LINEAGE');
        }

        for (const orderLineId of lineIds) {
          const currentTotal = ledger.confirmedByLine[orderLineId] ?? 0;
          const oldQuantity = quantityForLine(original, orderLineId);
          const replacementLine = current.lines.find(
            (line) => line.orderLineId === orderLineId,
          );
          const newQuantity = replacementLine
            ? replacementLine.requestedQuantity ??
              replacementLine.proposedQuantity
            : 0;
          const nextTotal = currentTotal - oldQuantity + newQuantity;

          if (nextTotal < 0) throw new Error('INVALID_CONFIRMATION_LEDGER');
          if (nextTotal > (orderLineQuantities.get(orderLineId) ?? 0)) {
            throw new Error(
              `CONFIRMATION_EXCEEDS_REMAINING:${orderLineId}`,
            );
          }

          ledger.confirmedByLine[orderLineId] = nextTotal;
        }

        const finalized = approveReplacementRevisionAtomically({
          original,
          replacement: current,
          actorName: input.actorId,
          confirmedAt: input.occurredAt,
        });

        const originalRecord: ConfirmationRecord = {
          ...finalized.original,
          createdAt: original.createdAt,
          createdBy: original.createdBy,
          updatedAt: input.occurredAt,
          updatedBy: input.actorId,
        };
        const replacementRecord: ConfirmationRecord = {
          ...finalized.replacement,
          createdAt: current.createdAt,
          createdBy: current.createdBy,
          updatedAt: input.occurredAt,
          updatedBy: input.actorId,
        };

        ledger.updatedAt = input.occurredAt;

        const confirmedEvent = createDomainEvent({
          id: `confirmation-confirmed:${replacementRecord.id}:r${replacementRecord.revision}`,
          type: 'CONFIRMATION_CONFIRMED',
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          seasonId: replacementRecord.seasonId,
          organizationId: replacementRecord.organizationId,
          entityType: 'CONFIRMATION',
          entityId: replacementRecord.id,
          entityRevision: replacementRecord.revision,
          payload: {
            fromStatus: 'CHANGE_REQUESTED',
            toStatus: 'CONFIRMED',
            replacesConfirmationId: originalRecord.id,
          },
        });

        const supersededEvent = createDomainEvent({
          id: `confirmation-superseded:${originalRecord.id}:by:${replacementRecord.id}`,
          type: 'CONFIRMATION_SUPERSEDED',
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          seasonId: originalRecord.seasonId,
          organizationId: originalRecord.organizationId,
          entityType: 'CONFIRMATION',
          entityId: originalRecord.id,
          entityRevision: originalRecord.revision,
          payload: {
            fromStatus: 'CONFIRMED',
            toStatus: 'SUPERSEDED',
            replacementId: replacementRecord.id,
          },
        });

        const confirmedEventRef = doc(this.db, EVENTS, confirmedEvent.id);
        const supersededEventRef = doc(this.db, EVENTS, supersededEvent.id);
        const [confirmedEventSnapshot, supersededEventSnapshot] =
          await Promise.all([
            transaction.get(confirmedEventRef),
            transaction.get(supersededEventRef),
          ]);

        if (
          confirmedEventSnapshot.exists() ||
          supersededEventSnapshot.exists()
        ) {
          throw new Error('DUPLICATE_EVENT_ID');
        }

        transaction.set(
          originalRef!,
          cleanForFirestore(originalRecord),
        );
        transaction.set(
          confirmationRef,
          cleanForFirestore(replacementRecord),
        );
        transaction.set(ledgerRef, ledger);
        transaction.set(
          confirmedEventRef,
          cleanForFirestore(confirmedEvent),
        );
        transaction.set(
          supersededEventRef,
          cleanForFirestore(supersededEvent),
        );

        return replacementRecord;
      }

      const confirmed = approveRequestedChanges({
        confirmation: current,
        actorName: input.actorId,
        confirmedAt: input.occurredAt,
      });

      for (const line of confirmed.lines) {
        const currentTotal = ledger.confirmedByLine[line.orderLineId] ?? 0;
        const nextTotal =
          currentTotal + (line.confirmedQuantity ?? 0);
        if (nextTotal > (orderLineQuantities.get(line.orderLineId) ?? 0)) {
          throw new Error(
            `CONFIRMATION_EXCEEDS_REMAINING:${line.orderLineId}`,
          );
        }
        ledger.confirmedByLine[line.orderLineId] = nextTotal;
      }
      ledger.updatedAt = input.occurredAt;

      const next: ConfirmationRecord = {
        ...confirmed,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const event = createDomainEvent({
        id: `confirmation-confirmed:${next.id}:r${next.revision}`,
        type: 'CONFIRMATION_CONFIRMED',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: next.seasonId,
        organizationId: next.organizationId,
        entityType: 'CONFIRMATION',
        entityId: next.id,
        entityRevision: next.revision,
        payload: {
          fromStatus: current.status,
          toStatus: 'CONFIRMED',
        },
      });

      const eventRef = doc(this.db, EVENTS, event.id);
      const priorEvent = await transaction.get(eventRef);
      if (priorEvent.exists()) throw new Error('DUPLICATE_EVENT_ID');

      transaction.set(ledgerRef, ledger);
      transaction.set(confirmationRef, cleanForFirestore(next));
      transaction.set(eventRef, cleanForFirestore(event));
      return next;
    });
  }
}

export class FirestorePublicConfirmationRepository
  implements
    ConfirmationTokenAdminRepository,
    ConfirmationDispatchRepository
{
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}


  async dispatchWithTokenTransaction(input: {
    confirmationId: string;
    token: PublicConfirmationTokenRecord;
    actorId: string;
    occurredAt: string;
  }): Promise<ConfirmationRecord> {
    if (input.token.confirmationId !== input.confirmationId) {
      throw new Error('TOKEN_CONFIRMATION_MISMATCH');
    }
    if (!input.token.active || input.token.usedAt || input.token.revokedAt) {
      throw new Error('TOKEN_NOT_ACTIVE');
    }

    const confirmationRef = doc(
      this.db,
      CONFIRMATIONS,
      input.confirmationId,
    );
    const tokenRef = doc(this.db, TOKENS, input.token.id);

    return runTransaction(this.db, async (transaction) => {
      const [confirmationSnapshot, tokenSnapshot] = await Promise.all([
        transaction.get(confirmationRef),
        transaction.get(tokenRef),
      ]);

      if (!confirmationSnapshot.exists()) {
        throw new Error('CONFIRMATION_NOT_FOUND');
      }
      if (tokenSnapshot.exists()) throw new Error('TOKEN_ALREADY_EXISTS');

      const current = confirmationFromData(
        confirmationSnapshot.id,
        confirmationSnapshot.data(),
      );
      if (current.status !== 'DRAFT') {
        throw new Error('INVALID_CONFIRMATION_STATE');
      }

      const sentDomain = markConfirmationSent(
        current,
        input.occurredAt,
      );
      const sent: ConfirmationRecord = {
        ...sentDomain,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const event = createDomainEvent({
        id: `confirmation-sent:${sent.id}:r${sent.revision}`,
        type: 'CONFIRMATION_SENT',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: sent.seasonId,
        organizationId: sent.organizationId,
        entityType: 'CONFIRMATION',
        entityId: sent.id,
        entityRevision: sent.revision,
        payload: {
          fromStatus: 'DRAFT',
          toStatus: 'SENT',
          tokenId: input.token.id,
        },
      });

      const eventRef = doc(this.db, EVENTS, event.id);
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists()) throw new Error('DUPLICATE_EVENT_ID');

      transaction.set(confirmationRef, cleanForFirestore(sent));
      transaction.set(tokenRef, cleanForFirestore(input.token));
      transaction.set(eventRef, cleanForFirestore(event));

      return sent;
    });
  }

  async revokeTransaction(input: {
    tokenId: string;
    occurredAt: string;
  }): Promise<void> {
    const ref = doc(this.db, TOKENS, input.tokenId);
    await runTransaction(this.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error('TOKEN_NOT_FOUND');
      const token = tokenFromData(snapshot.id, snapshot.data());
      if (token.usedAt) throw new Error('TOKEN_ALREADY_USED');
      transaction.set(
        ref,
        cleanForFirestore({
          ...token,
          active: false,
          revokedAt: input.occurredAt,
        }),
      );
    });
  }

}
