import {
  doc,
  getDoc,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import type {
  BillingSheetRecord,
  InvoicingRepository,
  PaymentRecord,
  PaymentRepository,
} from '../contracts/persistence';
import { fakturaV2CoreDb } from '../adapters/firebaseBackends';
import { createDomainEvent } from '../domain/events';

const BILLING_COLLECTION = 'fakturaBillingSheets';
const PAYMENT_COLLECTION = 'fakturaPayments';
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

function requiresPrepayment(sheet: BillingSheetRecord) {
  return sheet.lines.some(
    (line) =>
      line.sourceType === 'ORDER_CONFIRMATION' &&
      line.quantity > 0 &&
      line.prepaymentRequired === true,
  );
}

export class FirestoreInvoicingRepository
  implements InvoicingRepository
{
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async invoiceAndOpenPaymentTransaction(input: {
    billingSheetId: string;
    actorId: string;
    occurredAt: string;
    reference?: string;
  }): Promise<{
    billingSheet: BillingSheetRecord;
    payment: PaymentRecord;
  }> {
    const billingRef = doc(
      this.db,
      BILLING_COLLECTION,
      input.billingSheetId,
    );
    const paymentRef = doc(
      this.db,
      PAYMENT_COLLECTION,
      input.billingSheetId,
    );

    return runTransaction(this.db, async (transaction) => {
      const [billingSnapshot, paymentSnapshot] = await Promise.all([
        transaction.get(billingRef),
        transaction.get(paymentRef),
      ]);

      if (!billingSnapshot.exists()) {
        throw new Error('BILLING_SHEET_NOT_FOUND');
      }

      const ready = billingRecordFromData(
        billingSnapshot.id,
        billingSnapshot.data(),
      );

      if (ready.status !== 'READY') {
        throw new Error('INVALID_BILLING_STATE');
      }

      if (paymentSnapshot.exists()) {
        throw new Error('PAYMENT_CASE_ALREADY_EXISTS');
      }

      const invoiced: BillingSheetRecord = {
        ...ready,
        status: 'INVOICED',
        invoicedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const payment: PaymentRecord = {
        billingSheetId: invoiced.id,
        required: requiresPrepayment(invoiced),
        status: 'OPEN',
        reference: input.reference,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const billingEvent = createDomainEvent({
        id: `billing-invoiced:${invoiced.id}:r${invoiced.revision}`,
        type: 'BILLING_INVOICED',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: invoiced.seasonId,
        organizationId: invoiced.organizationId,
        entityType: 'BILLING_SHEET',
        entityId: invoiced.id,
        entityRevision: invoiced.revision,
        payload: {
          fromStatus: 'READY',
          toStatus: 'INVOICED',
          totalAmount: invoiced.totalAmount,
        },
      });

      const paymentEvent = createDomainEvent({
        id: `payment-open:${payment.billingSheetId}`,
        type: 'PAYMENT_MARKED_OPEN',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: invoiced.seasonId,
        organizationId: invoiced.organizationId,
        entityType: 'PAYMENT',
        entityId: payment.billingSheetId,
        entityRevision: invoiced.revision,
        payload: {
          toStatus: 'OPEN',
          reference: payment.reference,
        },
      });

      const billingEventRef = doc(
        this.db,
        EVENTS_COLLECTION,
        billingEvent.id,
      );
      const paymentEventRef = doc(
        this.db,
        EVENTS_COLLECTION,
        paymentEvent.id,
      );

      const [existingBillingEvent, existingPaymentEvent] = await Promise.all([
        transaction.get(billingEventRef),
        transaction.get(paymentEventRef),
      ]);

      if (existingBillingEvent.exists() || existingPaymentEvent.exists()) {
        throw new Error('DUPLICATE_EVENT_ID');
      }

      transaction.set(billingRef, cleanForFirestore(invoiced));
      transaction.set(paymentRef, cleanForFirestore(payment));
      transaction.set(billingEventRef, cleanForFirestore(billingEvent));
      transaction.set(paymentEventRef, cleanForFirestore(paymentEvent));

      return { billingSheet: invoiced, payment };
    });
  }
}

export class FirestorePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Firestore = fakturaV2CoreDb) {}

  async getByBillingSheetId(
    billingSheetId: string,
  ): Promise<PaymentRecord | null> {
    const snapshot = await getDoc(
      doc(this.db, PAYMENT_COLLECTION, billingSheetId),
    );
    if (!snapshot.exists()) return null;
    return paymentRecordFromData(snapshot.id, snapshot.data());
  }

  async setStatusTransaction(input: {
    billingSheetId: string;
    status: PaymentRecord['status'];
    actorId: string;
    occurredAt: string;
    reference?: string;
  }): Promise<PaymentRecord> {
    const billingRef = doc(
      this.db,
      BILLING_COLLECTION,
      input.billingSheetId,
    );
    const paymentRef = doc(
      this.db,
      PAYMENT_COLLECTION,
      input.billingSheetId,
    );

    return runTransaction(this.db, async (transaction) => {
      const [billingSnapshot, paymentSnapshot] = await Promise.all([
        transaction.get(billingRef),
        transaction.get(paymentRef),
      ]);

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
      if (billing.status !== 'INVOICED') {
        throw new Error('BILLING_NOT_INVOICED');
      }

      const current = paymentRecordFromData(
        paymentSnapshot.id,
        paymentSnapshot.data(),
      );

      if (input.status === 'OPEN') {
        if (current.status !== 'OPEN') {
          throw new Error('PAYMENT_CANNOT_REOPEN');
        }
        return current;
      }

      if (current.status === 'PAID') {
        if (
          input.reference !== undefined &&
          current.reference !== input.reference
        ) {
          throw new Error('PAYMENT_ALREADY_PAID');
        }
        return current;
      }

      const paid: PaymentRecord = {
        ...current,
        status: 'PAID',
        paidAt: input.occurredAt,
        reference: input.reference ?? current.reference,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      const event = createDomainEvent({
        id: `payment-paid:${paid.billingSheetId}`,
        type: 'PAYMENT_MARKED_PAID',
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        seasonId: billing.seasonId,
        organizationId: billing.organizationId,
        entityType: 'PAYMENT',
        entityId: paid.billingSheetId,
        entityRevision: billing.revision,
        payload: {
          fromStatus: 'OPEN',
          toStatus: 'PAID',
          reference: paid.reference,
        },
      });

      const eventRef = doc(this.db, EVENTS_COLLECTION, event.id);
      const existingEvent = await transaction.get(eventRef);
      if (existingEvent.exists()) {
        throw new Error('DUPLICATE_EVENT_ID');
      }

      transaction.set(paymentRef, cleanForFirestore(paid));
      transaction.set(eventRef, cleanForFirestore(event));

      return paid;
    });
  }
}
