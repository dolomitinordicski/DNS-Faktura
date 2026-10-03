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
  BillingSheetRecord,
  DeliveryRecord,
  DeliveryRepository,
  PaymentRecord,
} from '../contracts/persistence';
import { fakturaV2CoreDb } from '../adapters/firebaseBackends';
import {
  createDeliveryFromBilling,
  recordDeliveryQuantity,
} from '../engine/deliveryEngine';
import { createDomainEvent } from '../domain/events';

const BILLING_COLLECTION = 'fakturaBillingSheets';
const PAYMENT_COLLECTION = 'fakturaPayments';
const DELIVERY_COLLECTION = 'fakturaDeliveries';
const EVENTS_COLLECTION = 'fakturaEvents';

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

function paymentRecordFromData(
  id: string,
  data: Record<string, unknown>,
): PaymentRecord {
  if (
    typeof data.billingSheetId !== 'string' ||
    typeof data.required !== 'boolean' ||
    (data.status !== 'OPEN' && data.status !== 'PAID') ||
    typeof data.updatedAt !== 'string' ||
    typeof data.updatedBy !== 'string'
  ) {
    throw new Error(`INVALID_PAYMENT_RECORD:${id}`);
  }
  return {
    ...(data as unknown as PaymentRecord),
    billingSheetId: data.billingSheetId,
  };
}

function deliveryRecordFromData(
  id: string,
  data: Record<string, unknown>,
): DeliveryRecord {
  if (
    typeof data.seasonId !== 'string' ||
    typeof data.organizationId !== 'string' ||
    typeof data.orderId !== 'string' ||
    typeof data.billingSheetId !== 'string' ||
    !Array.isArray(data.confirmationIds) ||
    !Array.isArray(data.lines) ||
    (data.status !== 'PENDING' &&
      data.status !== 'PARTIAL' &&
      data.status !== 'DELIVERED') ||
    typeof data.createdAt !== 'string' ||
    typeof data.createdBy !== 'string'
  ) {
    throw new Error(`INVALID_DELIVERY_RECORD:${id}`);
  }
  return {
    ...(data as unknown as DeliveryRecord),
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

function sameDeliveryShape(
  expected: ReturnType<typeof createDeliveryFromBilling>,
  actual: DeliveryRecord,
) {
  if (
    expected.id !== actual.id ||
    expected.seasonId !== actual.seasonId ||
    expected.organizationId !== actual.organizationId ||
    expected.orderId !== actual.orderId ||
    expected.billingSheetId !== actual.billingSheetId ||
    expected.status !== actual.status
  ) {
    return false;
  }

  const expectedConfirmations = [...expected.confirmationIds].sort();
  const actualConfirmations = [...actual.confirmationIds].sort();
  if (
    expectedConfirmations.length !== actualConfirmations.length ||
    expectedConfirmations.some(
      (value, index) => value !== actualConfirmations[index],
    )
  ) {
    return false;
  }

  const expectedLines = [...expected.lines].sort((a, b) =>
    a.catalogItemId.localeCompare(b.catalogItemId),
  );
  const actualLines = [...actual.lines].sort((a, b) =>
    a.catalogItemId.localeCompare(b.catalogItemId),
  );

  if (expectedLines.length !== actualLines.length) return false;

  return expectedLines.every((line, index) => {
    const candidate = actualLines[index];
    return (
      line.catalogItemId === candidate.catalogItemId &&
      line.confirmedQuantity === candidate.confirmedQuantity &&
      candidate.deliveredQuantity === 0 &&
      candidate.remainingQuantity === candidate.confirmedQuantity
    );
  });
}

export class FirestoreDeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async getById(id: string): Promise<DeliveryRecord | null> {
    const snapshot = await getDoc(doc(this.db, DELIVERY_COLLECTION, id));
    if (!snapshot.exists()) return null;
    return deliveryRecordFromData(snapshot.id, snapshot.data());
  }

  async listByOrganization(input: {
    seasonId: string;
    organizationId: string;
  }): Promise<DeliveryRecord[]> {
    const snapshot = await getDocs(
      query(
        collection(this.db, DELIVERY_COLLECTION),
        where('seasonId', '==', input.seasonId),
      ),
    );

    return snapshot.docs
      .map((item) => deliveryRecordFromData(item.id, item.data()))
      .filter((item) => item.organizationId === input.organizationId)
      .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  }

  async createTransaction(record: DeliveryRecord): Promise<void> {
    if (record.status !== 'PENDING') {
      throw new Error('DELIVERY_MUST_START_PENDING');
    }

    const deliveryRef = doc(this.db, DELIVERY_COLLECTION, record.id);
    const billingRef = doc(
      this.db,
      BILLING_COLLECTION,
      record.billingSheetId,
    );
    const paymentRef = doc(
      this.db,
      PAYMENT_COLLECTION,
      record.billingSheetId,
    );

    await runTransaction(this.db, async (transaction) => {
      const [deliverySnapshot, billingSnapshot, paymentSnapshot] =
        await Promise.all([
          transaction.get(deliveryRef),
          transaction.get(billingRef),
          transaction.get(paymentRef),
        ]);

      if (deliverySnapshot.exists()) {
        throw new Error('DELIVERY_ALREADY_EXISTS');
      }
      if (!billingSnapshot.exists()) {
        throw new Error('BILLING_SHEET_NOT_FOUND');
      }
      if (!paymentSnapshot.exists()) {
        throw new Error('PAYMENT_CASE_NOT_FOUND');
      }

      const billing = billingRecordFromData(
        billingSnapshot.id,
        billingSnapshot.data(),
      );
      const payment = paymentRecordFromData(
        paymentSnapshot.id,
        paymentSnapshot.data(),
      );

      const expected = createDeliveryFromBilling({
        id: record.id,
        orderId: record.orderId,
        confirmationIds: record.confirmationIds,
        billingSheet: billing,
        payment,
      });

      if (!sameDeliveryShape(expected, record)) {
        throw new Error('DELIVERY_SNAPSHOT_MISMATCH');
      }

      const event = createDomainEvent({
        id: `delivery-created:${record.id}`,
        type: 'DELIVERY_CREATED',
        occurredAt: record.createdAt,
        actorId: record.createdBy,
        seasonId: record.seasonId,
        organizationId: record.organizationId,
        entityType: 'DELIVERY',
        entityId: record.id,
        payload: {
          toStatus: 'PENDING',
          billingSheetId: record.billingSheetId,
          orderId: record.orderId,
        },
      });

      const eventRef = doc(this.db, EVENTS_COLLECTION, event.id);
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists()) {
        throw new Error('DUPLICATE_EVENT_ID');
      }

      transaction.set(deliveryRef, cleanForFirestore(record));
      transaction.set(eventRef, cleanForFirestore(event));
    });
  }

  async recordQuantityTransaction(input: {
    deliveryId: string;
    catalogItemId: string;
    deliveredQuantity: number;
    actorId: string;
    occurredAt: string;
  }): Promise<DeliveryRecord> {
    const deliveryRef = doc(
      this.db,
      DELIVERY_COLLECTION,
      input.deliveryId,
    );

    return runTransaction(this.db, async (transaction) => {
      const snapshot = await transaction.get(deliveryRef);
      if (!snapshot.exists()) {
        throw new Error('DELIVERY_NOT_FOUND');
      }

      const current = deliveryRecordFromData(
        snapshot.id,
        snapshot.data(),
      );

      const nextDomain = recordDeliveryQuantity({
        delivery: current,
        catalogItemId: input.catalogItemId,
        deliveredQuantity: input.deliveredQuantity,
      });

      const next: DeliveryRecord = {
        ...nextDomain,
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const eventType =
        next.status === 'DELIVERED' && current.status !== 'DELIVERED'
          ? 'DELIVERY_COMPLETED'
          : 'DELIVERY_UPDATED';

      const line = next.lines.find(
        (candidate) => candidate.catalogItemId === input.catalogItemId,
      )!;

      const event = createDomainEvent({
        id: `delivery:${next.id}:${input.catalogItemId}:${String(
          input.deliveredQuantity,
        )}:${input.occurredAt}`,
        type: eventType,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: next.seasonId,
        organizationId: next.organizationId,
        entityType: 'DELIVERY',
        entityId: next.id,
        payload: {
          fromStatus: current.status,
          toStatus: next.status,
          deliveredQuantity: line.deliveredQuantity,
          remainingQuantity: line.remainingQuantity,
          catalogItemId: line.catalogItemId,
        },
      });

      const eventRef = doc(this.db, EVENTS_COLLECTION, event.id);
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists()) {
        throw new Error('DUPLICATE_EVENT_ID');
      }

      transaction.set(deliveryRef, cleanForFirestore(next));
      transaction.set(eventRef, cleanForFirestore(event));

      return next;
    });
  }
}
