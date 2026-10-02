import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type {
  BillingSheetRecord,
  BillingSheetRepository,
} from '../contracts/persistence';
import { fakturaV2CoreDb } from '../adapters/firebaseBackends';
import { createDomainEvent } from '../domain/events';

const BILLING_COLLECTION = 'fakturaBillingSheets';
const EVENTS_COLLECTION = 'fakturaEvents';
const CONFIRMATIONS_COLLECTION = 'fakturaConfirmations';
const RATE_COLLECTION = 'billingRateConfigs';
const ALLOCATION_COLLECTION = 'areaAllocationKeys';

function billingRecordFromData(
  id: string,
  data: Record<string, unknown>,
): BillingSheetRecord {
  if (
    typeof data.seasonId !== 'string' ||
    typeof data.organizationId !== 'string' ||
    typeof data.revision !== 'number' ||
    (data.status !== 'DRAFT' &&
      data.status !== 'READY' &&
      data.status !== 'INVOICED') ||
    !Array.isArray(data.lines) ||
    typeof data.totalAmount !== 'number' ||
    typeof data.createdAt !== 'string' ||
    typeof data.createdBy !== 'string'
  ) {
    throw new Error(`INVALID_BILLING_RECORD:${id}`);
  }

  return {
    ...(data as unknown as BillingSheetRecord),
    id,
  };
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

function readyEventId(sheet: BillingSheetRecord) {
  return `billing-ready:${sheet.id}:r${sheet.revision}`;
}

export class FirestoreBillingSheetRepository
  implements BillingSheetRepository
{
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async getById(id: string): Promise<BillingSheetRecord | null> {
    const snapshot = await getDoc(doc(this.db, BILLING_COLLECTION, id));
    if (!snapshot.exists()) return null;
    return billingRecordFromData(snapshot.id, snapshot.data());
  }

  async listByOrganization(input: {
    seasonId: string;
    organizationId: string;
  }): Promise<BillingSheetRecord[]> {
    const snapshot = await getDocs(
      query(
        collection(this.db, BILLING_COLLECTION),
        where('seasonId', '==', input.seasonId),
        where('organizationId', '==', input.organizationId),
      ),
    );

    return snapshot.docs
      .map((item) => billingRecordFromData(item.id, item.data()))
      .sort((a, b) => b.revision - a.revision);
  }

  async saveDraft(record: BillingSheetRecord): Promise<void> {
    if (record.status !== 'DRAFT') {
      throw new Error('ONLY_DRAFT_CAN_BE_SAVED');
    }

    const ref = doc(this.db, BILLING_COLLECTION, record.id);

    await runTransaction(this.db, async (transaction) => {
      const current = await transaction.get(ref);

      if (current.exists()) {
        const existing = billingRecordFromData(current.id, current.data());
        if (existing.status !== 'DRAFT') {
          throw new Error('BILLING_SHEET_FROZEN');
        }
        if (
          existing.seasonId !== record.seasonId ||
          existing.organizationId !== record.organizationId ||
          existing.revision !== record.revision
        ) {
          throw new Error('BILLING_DRAFT_SCOPE_OR_REVISION_MISMATCH');
        }
      }

      transaction.set(ref, cleanForFirestore(record));
    });
  }

  async markReadyTransaction(input: {
    billingSheetId: string;
    actorId: string;
    occurredAt: string;
    expectedUpdatedAt: string;
  }): Promise<BillingSheetRecord> {
    const billingRef = doc(
      this.db,
      BILLING_COLLECTION,
      input.billingSheetId,
    );

    return runTransaction(this.db, async (transaction) => {
      const current = await transaction.get(billingRef);
      if (!current.exists()) {
        throw new Error('BILLING_SHEET_NOT_FOUND');
      }

      const draft = billingRecordFromData(current.id, current.data());

      if (draft.status !== 'DRAFT') {
        throw new Error('INVALID_BILLING_STATE');
      }

      if (draft.updatedAt !== input.expectedUpdatedAt) {
        throw new Error('BILLING_DRAFT_CHANGED');
      }

      const confirmationLines = draft.lines.filter(
        (line) => line.sourceType === 'ORDER_CONFIRMATION',
      );

      const confirmationIds = [
        ...new Set(confirmationLines.map((line) => line.sourceId)),
      ];
      const confirmationSnapshots = new Map<string, Record<string, unknown>>();

      for (const confirmationId of confirmationIds) {
        const snapshot = await transaction.get(
          doc(this.db, CONFIRMATIONS_COLLECTION, confirmationId),
        );
        if (!snapshot.exists()) {
          throw new Error(`READY_CONFIRMATION_MISSING:${confirmationId}`);
        }
        confirmationSnapshots.set(
          confirmationId,
          snapshot.data() as Record<string, unknown>,
        );
      }

      for (const line of confirmationLines) {
        const confirmation = confirmationSnapshots.get(line.sourceId)!;
        if (
          confirmation.status !== 'CONFIRMED' ||
          confirmation.revision !== line.sourceRevision ||
          confirmation.seasonId !== draft.seasonId ||
          confirmation.organizationId !== draft.organizationId ||
          confirmation.orderId !== line.orderId ||
          !Array.isArray(confirmation.lines)
        ) {
          throw new Error(`READY_CONFIRMATION_CHANGED:${line.sourceId}`);
        }

        const prefix = `${line.sourceId}:`;
        const orderLineId = line.id.startsWith(prefix)
          ? line.id.slice(prefix.length)
          : '';
        const confirmationLine = (
          confirmation.lines as Array<Record<string, unknown>>
        ).find((candidate) => candidate.orderLineId === orderLineId);

        if (
          !confirmationLine ||
          confirmationLine.catalogItemId !== line.catalogItemId ||
          confirmationLine.confirmedQuantity !== line.quantity
        ) {
          throw new Error(`READY_CONFIRMATION_CHANGED:${line.sourceId}`);
        }

        if (
          !line.rateId ||
          line.rateRevision === undefined ||
          !line.catalogItemId
        ) {
          throw new Error(`READY_RATE_LINEAGE_MISSING:${line.id}`);
        }

        const rateSnapshot = await transaction.get(
          doc(this.db, RATE_COLLECTION, line.rateId),
        );
        if (!rateSnapshot.exists()) {
          throw new Error(`READY_RATE_MISSING:${line.rateId}`);
        }
        const rate = rateSnapshot.data() as Record<string, unknown>;
        const prepaymentRequired =
          typeof rate.prepaymentRequired === 'boolean'
            ? rate.prepaymentRequired
            : true;

        if (
          rate.sourceType !== 'order' ||
          rate.catalogItemId !== line.catalogItemId ||
          rate.active !== true ||
          rate.revision !== line.rateRevision ||
          rate.billingUnitPrice !== line.unitPrice ||
          prepaymentRequired !== line.prepaymentRequired
        ) {
          throw new Error(`READY_RATE_CHANGED:${line.rateId}`);
        }
      }

      for (const line of draft.lines.filter(
        (candidate) => candidate.sourceType === 'IDM',
      )) {
        const parts = line.sourceId.split(':');
        if (
          parts.length !== 3 ||
          parts[0] !== 'idm' ||
          parts[1] !== draft.seasonId
        ) {
          throw new Error(`READY_IDM_LINEAGE_INVALID:${line.sourceId}`);
        }

        const reportingAreaId = parts[2];
        const allocationId = `${draft.seasonId}-${reportingAreaId}`;
        const allocationSnapshot = await transaction.get(
          doc(this.db, ALLOCATION_COLLECTION, allocationId),
        );
        if (!allocationSnapshot.exists()) {
          throw new Error(`READY_IDM_ALLOCATION_MISSING:${allocationId}`);
        }
        const allocation = allocationSnapshot.data() as Record<string, unknown>;

        if (
          allocation.active !== true ||
          allocation.seasonId !== draft.seasonId ||
          allocation.reportingAreaId !== reportingAreaId ||
          typeof allocation.revision !== 'number' ||
          (
            line.sourceRevision !== undefined &&
            allocation.revision > line.sourceRevision
          )
        ) {
          throw new Error(`READY_IDM_ALLOCATION_CHANGED:${allocationId}`);
        }
      }

      const eventId = readyEventId(draft);
      const eventRef = doc(this.db, EVENTS_COLLECTION, eventId);
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists()) {
        throw new Error('DUPLICATE_EVENT_ID');
      }

      const ready: BillingSheetRecord = {
        ...draft,
        status: 'READY',
        readyAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const event = createDomainEvent({
        id: eventId,
        type: 'BILLING_READY',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: ready.seasonId,
        organizationId: ready.organizationId,
        entityType: 'BILLING_SHEET',
        entityId: ready.id,
        entityRevision: ready.revision,
        payload: {
          fromStatus: 'DRAFT',
          toStatus: 'READY',
          totalAmount: ready.totalAmount,
        },
      });

      transaction.set(billingRef, cleanForFirestore(ready));
      transaction.set(eventRef, cleanForFirestore(event));

      return ready;
    });
  }

}

export async function putBillingDraftUnsafeForMigrationOnly(
  record: BillingSheetRecord,
  db: Firestore = fakturaV2CoreDb,
) {
  if (record.status !== 'DRAFT') throw new Error('ONLY_DRAFT_CAN_BE_SAVED');
  await setDoc(
    doc(db, BILLING_COLLECTION, record.id),
    cleanForFirestore(record),
  );
}
