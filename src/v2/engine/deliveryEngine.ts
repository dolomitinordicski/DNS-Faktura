import type {
  BillingSheet,
  Delivery,
  DeliveryLine,
  PaymentCase,
} from '../domain/types';

export function canReleaseForDelivery(input: {
  billingSheet: BillingSheet;
  payment: PaymentCase;
}) {
  if (input.billingSheet.status !== 'INVOICED') return false;

  const requiresPrepayment = input.billingSheet.lines.some(
    (line) => line.prepaymentRequired,
  );

  return !requiresPrepayment || input.payment.status === 'PAID';
}

export function updateDeliveredQuantity(input: {
  line: DeliveryLine;
  deliveredQuantity: number;
}): DeliveryLine {
  if (
    !Number.isFinite(input.deliveredQuantity) ||
    input.deliveredQuantity < 0 ||
    input.deliveredQuantity > input.line.confirmedQuantity
  ) {
    throw new Error('INVALID_DELIVERED_QUANTITY');
  }

  return {
    ...input.line,
    deliveredQuantity: input.deliveredQuantity,
    remainingQuantity:
      input.line.confirmedQuantity - input.deliveredQuantity,
  };
}

export function deriveDeliveryStatus(
  lines: DeliveryLine[],
): Delivery['status'] {
  const delivered = lines.reduce(
    (sum, line) => sum + line.deliveredQuantity,
    0,
  );
  const confirmed = lines.reduce(
    (sum, line) => sum + line.confirmedQuantity,
    0,
  );

  if (delivered === 0) return 'PENDING';
  if (delivered >= confirmed) return 'DELIVERED';
  return 'PARTIAL';
}
