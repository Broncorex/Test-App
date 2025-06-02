
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
  dimensionUnit?: string; // Added dimension unit
}

export interface Product {
  id: string;
  name: string; // required
  description: string; // required
  sku: string; // required, unique
  costPrice: number; // required
  basePrice: number; // required
  discountPercentage: number; // default: 0, range: 0-100
  discountAmount: number; // default: 0
  sellingPrice: number; // required, calculated
  unitOfMeasure?: string; // optional
  categoryIds: string[]; // required, array of active category IDs
  isAvailableForSale: boolean; // default: true
  promotionStartDate: Timestamp | null; // can be null
  promotionEndDate: Timestamp | null; // can be null
  imageUrl: string; // required, URL (Firebase Storage later)
  tags: string[]; // required
  lowStockThreshold: number; // required
  supplierId: string; // required, reference to an active supplier (primary)
  barcode: string; // required
  weight: number; // required
  dimensions: ProductDimension; // required
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // User UID
  isActive: boolean; // default: true (for soft-delete)
  // Fields like quantity and warehouseId are part of stockItems, not the core product definition
  // The following fields are temporary from mock data in inventory page and should be removed
  // once stockItems collection is implemented and product data is fetched correctly.
  category?: string; // Temporary for mock
  quantity?: number; // Temporary for mock
  price?: number; // Temporary for mock
  warehouseId?: string; // Temporary for mock
  lastUpdated?: string | Timestamp; // Temporary for mock
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
  type: 'inbound' | 'outbound' | 'adjustment' | 'TRANSFER_OUT' | 'TRANSFER_IN'; // Added transfer types
  quantityChanged: number;
  quantityBefore: number;
  quantityAfter: number;
  movementDate: Timestamp;
  userId?: string; // User performing the action
  reason?: string; // Required for adjustments, transfers
  notes?: string;
  relatedDocumentId?: string; // e.g., orderId, transferId, receiptId
  supplierId?: string; // Required for INBOUND type movements
}

export interface StockItem {
  id?: string; // Composite ID: productId_warehouseId
  productId: string;
  warehouseId: string;
  quantity: number;
  lastStockUpdate: Timestamp;
  updatedBy: string; // User UID
}

export interface User {
  id: string;
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  createdAt: Timestamp | Date; // Allow Date for client-side convenience before conversion
  isActive: boolean;
  createdBy?: string; // UID of admin/superadmin who created the user
  name?: string; // Potentially legacy or alternative display name
  assignedWarehouseIds?: string[]; // Array of warehouse IDs employee is assigned to
}

export interface Supplier {
  id: string;
  name: string; // required, unique
  contactPerson: string; // required
  contactEmail: string; // required
  contactPhone: string; // required
  address: string; // required
  notes: string; // Can be empty string
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // UID of the creating user
  isActive: boolean; // default: true
}

export interface Category {
  id: string;
  name: string; // required, unique within its parent
  description: string; // required
  parentCategoryId: string | null; // Can be null for top-level categories
  sortOrder: number; // required
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // User UID
  isActive: boolean; // default: true
}

// --- Requisition Management Types ---
export const REQUISITION_STATUSES = ["Pending Quotation", "Quoted", "PO in Progress", "Completed", "Canceled"] as const;
export type RequisitionStatus = typeof REQUISITION_STATUSES[number];

export interface RequiredProduct {
  id: string; // Firestore document ID for the subcollection item
  productId: string;
  productName: string; // Denormalized
  requiredQuantity: number;
  purchasedQuantity: number; // Default 0, updated as POs are fulfilled
  notes: string;
}

export interface Requisition {
  id: string; // Firestore document ID
  // requisitionId: string; // Custom/User-facing ID if needed, else use Firestore ID
  creationDate: Timestamp;
  requestingUserId: string;
  requestingUserName?: string; // Denormalized for display
  status: RequisitionStatus;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  requiredProducts?: RequiredProduct[]; // Populated after fetching subcollection
}

// --- Supplier Product (proveedorProductos) Types ---
export interface PriceRange {
  minQuantity: number;
  maxQuantity: number | null; // null for "or more"
  price: number | null; // null if negotiable
  priceType: "fixed" | "negotiable";
  additionalConditions?: string;
}

export interface ProveedorProducto {
  id: string; // Firestore document ID (e.g., supplierId_productId or auto-generated)
  supplierId: string;
  productId: string;
  lastPriceUpdate: Timestamp;
  priceRanges: PriceRange[];
  supplierSku: string; // Supplier's SKU for this product
  isAvailable: boolean; // Is this product currently available from this supplier
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string; // User UID
  isActive: boolean; // For soft-deleting specific supplier-product links
}
