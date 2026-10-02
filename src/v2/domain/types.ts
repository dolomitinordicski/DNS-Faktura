export type SeasonId = string;
export type OrganizationId = string;
export type CatalogItemId = string;

export type QuantityUnit = 'piece' | 'hour' | 'flat' | 'km' | 'custom';

export interface OrderLine {
  id: string;
  catalogItemId: CatalogItemId;
  category: string;
  label: string;
  orderedQuantity: number;
  unit: QuantityUnit;
}

export interface Order {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  status: 'DRAFT' | 'SUBMITTED';
  lines: OrderLine[];
}

export interface ConfirmationLine {
  orderLineId: string;
  catalogItemId: CatalogItemId;
  proposedQuantity: number;
  requestedQuantity?: number;
  confirmedQuantity?: number;
  unit: QuantityUnit;
}

export type ConfirmationStatus =
  | 'DRAFT'
  | 'SENT'
  | 'CHANGE_REQUESTED'
  | 'CONFIRMED'
  | 'SUPERSEDED'
  | 'VOIDED';

export interface Confirmation {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  orderId: string;
  revision: number;
  status: ConfirmationStatus;
  acceptanceTextVersion: string;
  lines: ConfirmationLine[];
  sentAt?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  supersedesConfirmationId?: string;
  supersededByConfirmationId?: string;
  supersededAt?: string;
  supersededBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  lifecycleReason?: string;
}

export type BillingSourceType =
  | 'FAIR'
  | 'IDM'
  | 'ORDER_CONFIRMATION'
  | 'MANUAL_SERVICE';

export interface BillingLine {
  id: string;
  sourceType: BillingSourceType;
  sourceId: string;
  catalogItemId?: CatalogItemId;
  description: string;
  quantity: number;
  unit: QuantityUnit;
  customUnitLabel?: string;
  unitPrice: number;
  amount: number;
  sourceRevision?: number;
  sourceDocument?: string;
  prepaymentRequired?: boolean;
  notes?: string;
}

export type BillingSheetStatus = 'DRAFT' | 'READY' | 'INVOICED';

export interface BillingSheet {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  revision: number;
  status: BillingSheetStatus;
  lines: BillingLine[];
  totalAmount: number;
  supersedesBillingSheetId?: string;
  revisionReason?: string;
  createdAt?: string;
  readyAt?: string;
  invoicedAt?: string;
}

export type PaymentStatus = 'OPEN' | 'PAID';

export interface PaymentCase {
  billingSheetId: string;
  required: boolean;
  status: PaymentStatus;
  paidAt?: string;
  reference?: string;
}

export interface DeliveryLine {
  catalogItemId: CatalogItemId;
  confirmedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

export type DeliveryStatus = 'PENDING' | 'PARTIAL' | 'DELIVERED';

export interface Delivery {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  orderId: string;
  billingSheetId: string;
  confirmationIds: string[];
  status: DeliveryStatus;
  lines: DeliveryLine[];
}
