import type {
  BillingSheet,
  Confirmation,
  Delivery,
  PaymentCase,
} from '../domain/types';

export function assertFrozenConfirmation(record: Confirmation) {
  if (
    record.status === 'CONFIRMED' ||
    record.status === 'SUPERSEDED' ||
    record.status === 'VOIDED'
  ) {
    return true;
  }
  throw new Error('CONFIRMATION_NOT_FROZEN');
}

export function assertFrozenBillingSheet(record: BillingSheet) {
  if (record.status === 'READY' || record.status === 'INVOICED') {
    return true;
  }
  throw new Error('BILLING_SHEET_NOT_FROZEN');
}

export function assertPaymentMatchesBilling(input: {
  payment: PaymentCase;
  billingSheet: BillingSheet;
}) {
  if (input.payment.billingSheetId !== input.billingSheet.id) {
    throw new Error('PAYMENT_CASE_MISMATCH');
  }
  return true;
}

export function assertDeliveryMatchesBilling(input: {
  delivery: Delivery;
  billingSheet: BillingSheet;
}) {
  if (input.delivery.billingSheetId !== input.billingSheet.id) {
    throw new Error('DELIVERY_BILLING_MISMATCH');
  }
  if (
    input.delivery.seasonId !== input.billingSheet.seasonId ||
    input.delivery.organizationId !== input.billingSheet.organizationId
  ) {
    throw new Error('DELIVERY_BILLING_SCOPE_MISMATCH');
  }
  return true;
}
