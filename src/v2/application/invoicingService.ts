import type {
  InvoicingRepository,
  PaymentRecord,
  PaymentRepository,
} from '../contracts/persistence';

export async function invoiceBillingAndOpenPayment(input: {
  billingSheetId: string;
  repository: InvoicingRepository;
  actorId: string;
  occurredAt: string;
  reference?: string;
}) {
  return input.repository.invoiceAndOpenPaymentTransaction({
    billingSheetId: input.billingSheetId,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    reference: input.reference,
  });
}

export async function markPaymentPaid(input: {
  billingSheetId: string;
  repository: PaymentRepository;
  actorId: string;
  occurredAt: string;
  reference?: string;
}): Promise<PaymentRecord> {
  return input.repository.setStatusTransaction({
    billingSheetId: input.billingSheetId,
    status: 'PAID',
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    reference: input.reference,
  });
}
