// =====================================================================
// CONTRATOS COMPARTIDOS - SAAS CONTABLE UNIPUTUMAYO (@saas/contracts)
// =====================================================================

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA_NEQUI_DAVIPLATA' | 'CREDITO_FIADO';
export type UserRole = 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'WAREHOUSE_MANAGER' | 'CASHIER';
export type UnitOfMeasure = 'UNIDAD' | 'METRO' | 'KILO' | 'LITRO' | 'BULTO';

export interface CartItemDto {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface CheckoutPosDto {
  branchId: string;
  paymentMethod: PaymentMethod;
  cashTendered: number;
  customerId?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
}

export interface InvoiceResponseDto {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  changeDue: number;
  status: 'COMPLETED' | 'VOIDED';
}

export interface CustomerCreditDto {
  id: string;
  documentNumber: string;
  name: string;
  phone: string;
  creditLimit: number;
  currentDebt: number;
  availableCredit: number;
}

export interface RecordPaymentDto {
  amount: number;
  paymentMethod: 'EFECTIVO' | 'TRANSFERENCIA_NEQUI_DAVIPLATA';
}

export interface ProductCatalogDto {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  unitOfMeasure: UnitOfMeasure;
  costPrice: number;
  salePrice: number;
  taxRate: number;
  stockOnHand: number;
}
