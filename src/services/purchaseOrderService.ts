
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  orderBy,
  writeBatch,
  QueryConstraint,
  DocumentData,
  QueryDocumentSnapshot,
  runTransaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  QuotationAdditionalCost,
  Supplier,
  User as AppUser,
} from "@/types";
import { getSupplierById } from "./supplierService";
import { getUserById } from "./userService"; 
import { getProductById } from "./productService"; 
import { handleRequisitionUpdateForPOCancellation } from "./requisitionService"; // Import new function

const purchaseOrdersCollection = collection(db, "purchaseOrders");

export interface CreatePurchaseOrderDetailData {
  productId: string;
  productName: string;
  orderedQuantity: number;
  unitPrice: number;
  notes: string;
}

export interface CreatePurchaseOrderData {
  supplierId: string;
  originRequisitionId: string;
  quotationReferenceId?: string | null;
  expectedDeliveryDate: Timestamp;
  notes: string;
  additionalCosts: QuotationAdditionalCost[];
  details: CreatePurchaseOrderDetailData[];
}

export const createPurchaseOrder = async (
  data: CreatePurchaseOrderData,
  creationUserId: string
): Promise<string> => {
  const batch = writeBatch(db);
  const now = Timestamp.now();

  const supplier = await getSupplierById(data.supplierId);
  if (!supplier || !supplier.isActive) {
    throw new Error("Supplier not found or is not active.");
  }

  const creationUser = await getUserById(creationUserId);
  if (!creationUser) {
    throw new Error("Creating user not found.");
  }

  if (data.details.length === 0) {
    throw new Error("A purchase order must have at least one product item.");
  }

  let productsSubtotal = 0;
  for (const detail of data.details) {
    const product = await getProductById(detail.productId);
    if (!product || !product.isActive) {
      throw new Error(`Product ${detail.productName} (ID: ${detail.productId}) is not valid or not active.`);
    }
    if (detail.orderedQuantity <= 0) {
      throw new Error(`Ordered quantity for ${detail.productName} must be positive.`);
    }
    if (detail.unitPrice < 0) {
      throw new Error(`Unit price for ${detail.productName} cannot be negative.`);
    }
    productsSubtotal += detail.orderedQuantity * detail.unitPrice;
  }

  const totalAmount = productsSubtotal + (data.additionalCosts?.reduce((sum, cost) => sum + cost.amount, 0) || 0);

  const purchaseOrderRef = doc(purchaseOrdersCollection);
  const poData: Omit<PurchaseOrder, "id" | "details" | "supplierName" | "creationUserName"> = {
    supplierId: data.supplierId,
    originRequisitionId: data.originRequisitionId,
    quotationReferenceId: data.quotationReferenceId || null,
    orderDate: now, 
    expectedDeliveryDate: data.expectedDeliveryDate,
    status: "Pending", 
    productsSubtotal,
    additionalCosts: data.additionalCosts || [],
    totalAmount,
    creationUserId: creationUserId,
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: creationUserId,
  };
  batch.set(purchaseOrderRef, poData);

  const detailsCollectionRef = collection(purchaseOrderRef, "details");
  data.details.forEach(detailData => {
    const detailRef = doc(detailsCollectionRef);
    const poDetail: Omit<PurchaseOrderDetail, "id"> = {
      productId: detailData.productId,
      productName: detailData.productName,
      orderedQuantity: detailData.orderedQuantity,
      receivedQuantity: 0, 
      unitPrice: detailData.unitPrice,
      subtotal: detailData.orderedQuantity * detailData.unitPrice,
      notes: detailData.notes,
    };
    batch.set(detailRef, poDetail);
  });

  await batch.commit();
  return purchaseOrderRef.id;
};

const getPODetails = async (poId: string): Promise<PurchaseOrderDetail[]> => {
  const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
  const q = query(detailsCollectionRef, orderBy("productName"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PurchaseOrderDetail));
};

export const getPurchaseOrderById = async (id: string): Promise<PurchaseOrder | null> => {
  if (!id) return null;
  const poRef = doc(db, "purchaseOrders", id);
  const poSnap = await getDoc(poRef);

  if (!poSnap.exists()) return null;

  const data = poSnap.data() as Omit<PurchaseOrder, "id" | "details">;
  const details = await getPODetails(id);

  let supplierName: string | undefined;
  let creationUserName: string | undefined;

  if (data.supplierId) {
    const supplier = await getSupplierById(data.supplierId);
    supplierName = supplier?.name;
  }
  if (data.creationUserId) {
    const user = await getUserById(data.creationUserId);
    creationUserName = user?.displayName;
  }

  return {
    id: poSnap.id,
    ...data,
    details,
    supplierName,
    creationUserName,
  };
};

export interface PurchaseOrderFilters {
  supplierId?: string;
  status?: PurchaseOrderStatus;
  orderDateFrom?: Timestamp;
  orderDateTo?: Timestamp;
  originRequisitionId?: string; // Added for fetching specific POs for a requisition
}

export const getAllPurchaseOrders = async (filters: PurchaseOrderFilters = {}): Promise<PurchaseOrder[]> => {
  let qConstraints: QueryConstraint[] = [];

  if (filters.supplierId) {
    qConstraints.push(where("supplierId", "==", filters.supplierId));
  }
  if (filters.status) {
    qConstraints.push(where("status", "==", filters.status));
  }
  if (filters.orderDateFrom) {
    qConstraints.push(where("orderDate", ">=", filters.orderDateFrom));
  }
  if (filters.orderDateTo) {
    qConstraints.push(where("orderDate", "<=", filters.orderDateTo));
  }
  if (filters.originRequisitionId) {
    qConstraints.push(where("originRequisitionId", "==", filters.originRequisitionId));
  }
  qConstraints.push(orderBy("orderDate", "desc"));

  const q = query(purchaseOrdersCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);

  const purchaseOrdersPromises = querySnapshot.docs.map(async (docSnap) => {
    const data = docSnap.data() as Omit<PurchaseOrder, "id" | "details" | "supplierName" | "creationUserName">;
    let supplierName: string | undefined;
    let creationUserName: string | undefined;

    if (data.supplierId) {
      const supplier = await getSupplierById(data.supplierId);
      supplierName = supplier?.name;
    }
    if (data.creationUserId) {
      const user = await getUserById(data.creationUserId);
      creationUserName = user?.displayName;
    }
    // Details are not fetched for list view for performance.
    return {
      id: docSnap.id,
      ...data,
      supplierName,
      creationUserName,
    } as PurchaseOrder; // Cast as PurchaseOrder (details will be undefined for list)
  });

  return Promise.all(purchaseOrdersPromises);
};

export const updatePurchaseOrderStatus = async (
  poId: string,
  newStatus: PurchaseOrderStatus,
  userId: string 
): Promise<void> => {
  const poRef = doc(db, "purchaseOrders", poId);
  let originalPO: PurchaseOrder | null = null;

  // Fetch original PO if we're potentially moving from Pending to Canceled
  if (newStatus === "Canceled") {
    originalPO = await getPurchaseOrderById(poId); // This fetches details too
    if (!originalPO) {
      throw new Error(`Purchase Order ${poId} not found during status update.`);
    }
  }
  
  const updateData: Partial<PurchaseOrder> = {
    status: newStatus,
    updatedAt: Timestamp.now(),
  };
  if (newStatus === "Completed" || newStatus === "Canceled") {
    updateData.completionDate = Timestamp.now();
  }
  
  await updateDoc(poRef, updateData);

  // After successfully updating PO status, if it was a Pending PO that got Canceled, update requisition
  if (originalPO && originalPO.status === "Pending" && newStatus === "Canceled" && originalPO.details) {
    await handleRequisitionUpdateForPOCancellation(originalPO.originRequisitionId, originalPO.details, userId);
  }
};
