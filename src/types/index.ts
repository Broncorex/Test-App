
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

export interface StockMovement {
  id: string;
  productId: string;
  warehouseId: string;
  type: 'inbound' | 'outbound' | 'adjustment' | 'TRANSFER_OUT' | 'TRANSFER_IN';
  quantityChanged: number;
  quantityBefore: number;
  quantityAfter: number;
  movementDate: Timestamp;
  userId?: string;
  reason?: string;
  notes?: string;
  relatedDocumentId?: string;
  supplierId?: string;
}

export interface StockItem {
  id?: string;
  productId: string;
  warehouseId: string;
  quantity: number;
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
  pendingPOQuantity?: number; // Added this field
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

// --- Purchase Order Types ---
export const PURCHASE_ORDER_STATUSES = ["Pending", "Sent", "Partially Received", "Completed", "Canceled"] as const;
export type PurchaseOrderStatus = typeof PURCHASE_ORDER_STATUSES[number];

export interface PurchaseOrderDetail {
  id: string; // Firestore document ID for the subcollection item
  productId: string;
  productName: string; // Denormalized
  orderedQuantity: number;
  receivedQuantity: number; // Default 0, updated during receipt
  unitPrice: number; // Price agreed upon in the PO
  subtotal: number; // orderedQuantity * unitPrice
  notes: string; // Item-specific notes for the PO
}

export interface PurchaseOrder {
  id: string; // Firestore document ID (purchaseOrderId)
  supplierId: string;
  supplierName?: string; // Denormalized
  originRequisitionId: string; // Link back to the requisition
  quotationReferenceId?: string | null; // Optional link to specific quotation
  orderDate: Timestamp;
  expectedDeliveryDate: Timestamp;
  status: PurchaseOrderStatus;
  productsSubtotal: number; // Sum of all detail subtotals
  additionalCosts: QuotationAdditionalCost[]; // Re-using type for consistency
  totalAmount: number; // productsSubtotal + sum of additionalCosts
  creationUserId: string; // User who created/finalized the PO from requisition
  creationUserName?: string; // Denormalized
  completionDate?: Timestamp | null; // When PO status becomes "Completed" or "Canceled"
  notes: string; // General notes for the PO
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // User UID (often same as creationUserId)
  // Subcollection 'details' will hold PurchaseOrderDetail items
  details?: PurchaseOrderDetail[]; // Populated after fetching subcollection
}
