
import type { LucideIcon } from 'lucide-react';
import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'employee' | 'admin' | 'superadmin';

export interface NavItemStructure {
  href: string;
  label: string;
  icon: LucideIcon;
  allowedRoles: UserRole[];
  subItems?: NavItemStructure[];
}

export interface ProductDimension {
  length: number;
  width: number;
  height: number;
  dimensionUnit?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  sku: string;
  costPrice: number;
  basePrice: number;
  discountPercentage: number;
  discountAmount: number;
  sellingPrice: number;
  unitOfMeasure?: string;
  categoryIds: string[];
  isAvailableForSale: boolean;
  promotionStartDate: Timestamp | null;
  promotionEndDate: Timestamp | null;
  imageUrl: string;
  tags: string[];
  lowStockThreshold: number;
  supplierId: string;
  barcode: string;
  weight: number;
  dimensions: ProductDimension;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  isActive: boolean;
  category?: string; 
  quantity?: number; 
  price?: number;    
  warehouseId?: string; 
  lastUpdated?: string | Timestamp; 
}


export interface Warehouse {
  id:string;
  name: string;
  location?: string;
  description?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  isActive: boolean;
  contactPerson: string;
  contactPhone: string;
  isDefault: boolean;
}

export type StockMovementType =
  | 'INBOUND_PO' // For OK items
  | 'INBOUND_PO_DAMAGED' // For Damaged items
  | 'PO_MISSING' // For Missing items (audit only)
  | 'INBOUND_TRANSFER'
  | 'INBOUND_ADJUSTMENT'
  | 'OUTBOUND_SALE'
  | 'OUTBOUND_TRANSFER'
  | 'OUTBOUND_ADJUSTMENT'
  | 'INITIAL_STOCK';

export interface StockMovement {
  id: string;
  productId: string;
  productName?: string; 
  warehouseId: string;
  warehouseName?: string; 
  type: StockMovementType;
  quantityChanged: number;
  quantityBefore: number; // For usable stock if type is INBOUND_PO, for damaged stock if INBOUND_PO_DAMAGED
  quantityAfter: number;  // For usable stock if type is INBOUND_PO, for damaged stock if INBOUND_PO_DAMAGED
  movementDate: Timestamp;
  userId?: string; 
  userName?: string; 
  reason: string; 
  notes: string; 
  relatedDocumentId?: string; 
  supplierId?: string; 
}

export interface StockItem {
  id?: string; 
  productId: string;
  warehouseId: string;
  quantity: number; // Represents usable stock.
  damagedQuantity?: number; // NEW FIELD: Represents damaged stock for this product in this warehouse.
  lastStockUpdate: Timestamp;
  updatedBy: string; 
}

export interface User {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  createdAt: Timestamp | Date;
  isActive: boolean;
  createdBy?: string;
  name?: string; 
  assignedWarehouseIds?: string[];
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  parentCategoryId: string | null;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  isActive: boolean;
}

export const REQUISITION_STATUSES = ["Pending Quotation", "Quoted", "PO in Progress", "Completed", "Canceled"] as const;
export type RequisitionStatus = typeof REQUISITION_STATUSES[number];

export interface RequiredProduct {
  id: string; 
  productId: string;
  productName: string;
  requiredQuantity: number;
  purchasedQuantity: number;
  pendingPOQuantity?: number;
  notes: string;
}

export interface Requisition {
  id: string;
  creationDate: Timestamp;
  requestingUserId: string;
  requestingUserName?: string;
  status: RequisitionStatus;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  requiredProducts?: RequiredProduct[];
}

export interface PriceRange {
  minQuantity: number;
  maxQuantity: number | null;
  price: number | null;
  priceType: "fixed" | "negotiable";
  additionalConditions?: string;
}

export interface ProveedorProducto {
  id: string;
  supplierId: string;
  productId: string;
  lastPriceUpdate: Timestamp;
  priceRanges: PriceRange[];
  supplierSku: string;
  isAvailable: boolean;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  isActive: boolean;
}

export const QUOTATION_STATUSES = ["Sent", "Received", "Rejected", "Awarded", "Lost", "Partially Awarded"] as const;
export type QuotationStatus = typeof QUOTATION_STATUSES[number];

export const QUOTATION_ADDITIONAL_COST_TYPES = ["logistics", "tax", "insurance", "other"] as const;
export type QuotationAdditionalCostType = typeof QUOTATION_ADDITIONAL_COST_TYPES[number];

export interface QuotationAdditionalCost {
  id?: string; // <--- Añade esta línea para resolver el error de 'id'
  description: string;
  amount: number;
  type: QuotationAdditionalCostType;
}

export interface QuotationDetail {
  id: string; 
  productId: string;
  productName: string;
  requiredQuantity: number;
  quotedQuantity: number;
  unitPriceQuoted: number;
  conditions: string;
  estimatedDeliveryDate: Timestamp;
  notes: string;
}

export interface Quotation {
  id: string;
  requisitionId: string;
  supplierId: string;
  supplierName?: string;
  requestDate: Timestamp;
  responseDeadline: Timestamp;
  status: QuotationStatus;
  productsSubtotal?: number;
  additionalCosts?: QuotationAdditionalCost[];
  totalQuotation?: number;
  shippingConditions?: string;
  generatedByUserId: string;
  generatedByUserName?: string;
  receivedDate?: Timestamp | null;
  notes: string;
  purchaseOrdersGenerated?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  quotationDetails?: QuotationDetail[];
}

export const PURCHASE_ORDER_STATUSES = [
  "Pending",
  "SentToSupplier",
  "ChangesProposedBySupplier",
  "PendingInternalReview",
  "ConfirmedBySupplier",
  "RejectedBySupplier",
  "PartiallyDelivered",
  "AwaitingFutureDelivery",
  "FullyReceived", // New status
  "Completed",
  "Canceled"
] as const;
export type PurchaseOrderStatus = typeof PURCHASE_ORDER_STATUSES[number];

export const SUPPLIER_SOLUTION_TYPES = ["CreditPartialCharge", "DiscountForImperfection", "FutureDelivery", "Other"] as const;
export type SupplierSolutionType = typeof SUPPLIER_SOLUTION_TYPES[number];


export interface PurchaseOrderDetail {
  id: string; 
  productId: string;
  productName: string; 
  orderedQuantity: number;
  receivedQuantity: number; // Total OK quantity received across all receipts for this PO item
  receivedDamagedQuantity?: number; // NEW: Total DAMAGED quantity received
  receivedMissingQuantity?: number; // NEW: Total MISSING quantity reported
  unitPrice: number; 
  subtotal: number; 
  notes: string; 
}

export interface PurchaseOrder {
  id: string; 
  supplierId: string;
  supplierName?: string; 
  originRequisitionId: string; 
  quotationReferenceId?: string | null; 
  orderDate: Timestamp;
  expectedDeliveryDate: Timestamp;
  status: PurchaseOrderStatus;
  productsSubtotal: number; 
  additionalCosts: QuotationAdditionalCost[]; 
  totalAmount: number; 
  creationUserId: string; 
  creationUserName?: string; 
  completionDate?: Timestamp | null; 
  notes: string; 
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; 
  details?: PurchaseOrderDetail[]; 

  originalDetails?: PurchaseOrderDetail[];
  originalAdditionalCosts?: QuotationAdditionalCost[];
  originalProductsSubtotal?: number;
  originalTotalAmount?: number;
  originalNotes?: string;
  originalExpectedDeliveryDate?: Timestamp | null;

  supplierAgreedSolutionType?: SupplierSolutionType;
  supplierAgreedSolutionDetails?: string;
}

export const RECEIPT_ITEM_STATUSES = ["Ok", "Damaged", "Missing"] as const;
export type ReceiptItemStatus = typeof RECEIPT_ITEM_STATUSES[number];

export interface ReceivedItem { // This is for items WITHIN a single Receipt document
  id: string; // Sub-collection document ID
  productId: string;
  productName: string; 
  quantityReceived: number; // This is the quantity *for this specific status* in THIS receipt.
  itemStatus: ReceiptItemStatus; // Indicates if this quantity is OK, Damaged, or Missing.
  notes: string;
}

export interface Receipt {
  id: string; 
  purchaseOrderId: string;
  receiptDate: Timestamp;
  receivingUserId: string; 
  receivingUserName?: string; 
  targetWarehouseId: string;
  targetWarehouseName?: string; 
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; 
  receivedItems?: ReceivedItem[]; 
}
