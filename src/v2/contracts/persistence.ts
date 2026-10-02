import type {
  BillingSheet,
  Confirmation,
  Delivery,
  PaymentCase,
} from '../domain/types';
import type { DomainEvent } from '../domain/events';

export interface PersistedVersion {
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ConfirmationRecord extends Confirmation, PersistedVersion {}

export type BillingSheetRecord =
  Omit<BillingSheet, 'createdAt'> &
  PersistedVersion;

export interface PaymentRecord extends PaymentCase {
  updatedAt: string;
  updatedBy: string;
}

export interface DeliveryRecord extends Delivery, PersistedVersion {}

export interface AuditEventRecord extends DomainEvent {}

export interface PublicConfirmationTokenRecord {
  id: string;
  confirmationId: string;
  tokenHash: string;
  active: boolean;
  createdAt: string;
  expiresAt?: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface ConfirmationRepository {
  getById(id: string): Promise<ConfirmationRecord | null>;
  listActiveByOrder(orderId: string): Promise<ConfirmationRecord[]>;
  createDraft(record: ConfirmationRecord): Promise<void>;
  confirmTransaction(input: {
    confirmationId: string;
    actorId: string;
    occurredAt: string;
  }): Promise<ConfirmationRecord>;
  finalizeReplacementTransaction(input: {
    originalId: string;
    replacementId: string;
    actorId: string;
    occurredAt: string;
  }): Promise<{
    original: ConfirmationRecord;
    replacement: ConfirmationRecord;
  }>;
}

export interface BillingSheetRepository {
  getById(id: string): Promise<BillingSheetRecord | null>;
  listByOrganization(input: {
    seasonId: string;
    organizationId: string;
  }): Promise<BillingSheetRecord[]>;
  saveDraft(record: BillingSheetRecord): Promise<void>;
  markReadyTransaction(input: {
    billingSheetId: string;
    actorId: string;
    occurredAt: string;
    expectedUpdatedAt: string;
    expectedConfirmationRevisions?: Record<string, number>;
    expectedRateRevisions?: Record<string, {
      rateId: string;
      rateRevision: number;
      unitPrice: number;
      active: boolean;
    }>;
  }): Promise<BillingSheetRecord>;
}

export interface InvoicingRepository {
  invoiceAndOpenPaymentTransaction(input: {
    billingSheetId: string;
    actorId: string;
    occurredAt: string;
    reference?: string;
  }): Promise<{
    billingSheet: BillingSheetRecord;
    payment: PaymentRecord;
  }>;
}

export interface PaymentRepository {
  getByBillingSheetId(billingSheetId: string): Promise<PaymentRecord | null>;
  setStatusTransaction(input: {
    billingSheetId: string;
    status: PaymentRecord['status'];
    actorId: string;
    occurredAt: string;
    reference?: string;
  }): Promise<PaymentRecord>;
}

export interface DeliveryRepository {
  getById(id: string): Promise<DeliveryRecord | null>;
  createTransaction(record: DeliveryRecord): Promise<void>;
  recordQuantityTransaction(input: {
    deliveryId: string;
    catalogItemId: string;
    deliveredQuantity: number;
    actorId: string;
    occurredAt: string;
  }): Promise<DeliveryRecord>;
}

export interface AuditEventRepository {
  append(event: AuditEventRecord): Promise<void>;
  listForEntity(input: {
    entityType: AuditEventRecord['entityType'];
    entityId: string;
  }): Promise<AuditEventRecord[]>;
}

export interface ConfirmationDispatchRepository {
  dispatchWithTokenTransaction(input: {
    confirmationId: string;
    token: PublicConfirmationTokenRecord;
    actorId: string;
    occurredAt: string;
  }): Promise<ConfirmationRecord>;
}

export interface ConfirmationTokenAdminRepository {
  revokeTransaction(input: {
    tokenId: string;
    occurredAt: string;
  }): Promise<void>;
}
