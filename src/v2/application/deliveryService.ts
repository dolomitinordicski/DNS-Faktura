import type {
  BillingSheetRepository,
  DeliveryRecord,
  DeliveryRepository,
  PaymentRepository,
} from '../contracts/persistence';
import { createDeliveryFromBilling } from '../engine/deliveryEngine';

export async function createDeliveryCase(input: {
  id: string;
  orderId: string;
  confirmationIds: string[];
  billingSheetId: string;
  billingRepository: BillingSheetRepository;
  paymentRepository: PaymentRepository;
  deliveryRepository: DeliveryRepository;
  actorId: string;
  occurredAt: string;
}): Promise<DeliveryRecord> {
  const [billingSheet, payment] = await Promise.all([
    input.billingRepository.getById(input.billingSheetId),
    input.paymentRepository.getByBillingSheetId(input.billingSheetId),
  ]);

  if (!billingSheet) throw new Error('BILLING_SHEET_NOT_FOUND');
  if (!payment) throw new Error('PAYMENT_CASE_NOT_FOUND');

  const delivery = createDeliveryFromBilling({
    id: input.id,
    orderId: input.orderId,
    confirmationIds: input.confirmationIds,
    billingSheet,
    payment,
  });

  const record: DeliveryRecord = {
    ...delivery,
    createdAt: input.occurredAt,
    createdBy: input.actorId,
    updatedAt: input.occurredAt,
    updatedBy: input.actorId,
  };

  await input.deliveryRepository.createTransaction(record);
  return record;
}

export async function recordDeliveredQuantity(input: {
  deliveryId: string;
  catalogItemId: string;
  deliveredQuantity: number;
  deliveryRepository: DeliveryRepository;
  actorId: string;
  occurredAt: string;
}): Promise<DeliveryRecord> {
  return input.deliveryRepository.recordQuantityTransaction({
    deliveryId: input.deliveryId,
    catalogItemId: input.catalogItemId,
    deliveredQuantity: input.deliveredQuantity,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  });
}
