
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
  deleteDoc,
  deleteField, 
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  QuotationAdditionalCost,
  Supplier,
  User as AppUser,
  SupplierSolutionType, 
} from "@/types";
import { getSupplierById } from "./supplierService";
import { getUserById } from "./userService";
import { getProductById } from "./productService";
import {
    updateRequisitionQuantitiesPostConfirmation,
    handleRequisitionUpdateForPOCancellation
} from "./requisitionService";

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
      receivedDamagedQuantity: 0,
      receivedMissingQuantity: 0,
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
  
  return snapshot.docs.map((docSnap: QueryDocumentSnapshot<DocumentData>) => ({ 
    id: docSnap.id, 
    ...docSnap.data() 
  } as PurchaseOrderDetail));
};

const getPODetailsInTransaction = async (poId: string, transaction: any): Promise<PurchaseOrderDetail[]> => {
  const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
  // For transactions, it's often better to read all documents in the collection if the number is small,
  // or have a known set of document IDs. Reading a query result within a transaction can be tricky
  // if the query itself depends on data that might change within the transaction.
  // For now, assuming a direct getDocs on the collection path for details.
  // If order is strictly needed and can't be guaranteed by doc IDs, post-fetch sort might be needed.
  const snapshot = await getDocs(query(detailsCollectionRef)); 
  
  const details: PurchaseOrderDetail[] = [];
  for (const docSnap of snapshot.docs) {
    // In a transaction, if you've already written to a doc, subsequent gets will see that write.
    // If not, it sees the server version at the start of the transaction.
    const detailRef = doc(db, `purchaseOrders/${poId}/details`, docSnap.id);
    const transactionSnap = await transaction.get(detailRef); // Ensure we get the transactional view
    if (transactionSnap.exists()) {
      details.push({ 
        id: transactionSnap.id, 
        ...transactionSnap.data() 
      } as PurchaseOrderDetail);
    }
  }
  return details.sort((a, b) => a.productName.localeCompare(b.productName)); // Sort after fetching
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
  originRequisitionId?: string;
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
    // Details are not fetched here for performance on list view.
    // Fetch them on demand in getPurchaseOrderById or the detail page.
    return {
      id: docSnap.id,
      ...data,
      supplierName,
      creationUserName,
    } as PurchaseOrder;
  });

  return Promise.all(purchaseOrdersPromises);
};

export interface UpdatePOWithChangesData {
  notes?: string;
  expectedDeliveryDate?: Timestamp;
  additionalCosts: QuotationAdditionalCost[];
  details: Array<{
    productId: string;
    productName: string;
    orderedQuantity: number;
    unitPrice: number;
    notes: string;
  }>;
}

export const updatePurchaseOrderDetailsAndCosts = async (
  poId: string,
  data: UpdatePOWithChangesData
): Promise<void> => {
  for (const detail of data.details) {
    const product = await getProductById(detail.productId);
    if (!product || !product.isActive) {
      throw new Error(`Product ${detail.productName} (ID: ${detail.productId}) is not valid or not active. Cannot update PO.`);
    }
  }

  await runTransaction(db, async (transaction) => {
    const poRef = doc(db, "purchaseOrders", poId);
    const poSnap = await transaction.get(poRef);

    if (!poSnap.exists()) {
      throw new Error(`Purchase Order ${poId} not found.`);
    }
    const currentPOData = poSnap.data() as PurchaseOrder;

    if (data.details.length === 0) {
      throw new Error("A purchase order must have at least one product item after changes.");
    }

    let newProductsSubtotal = 0;
    for (const detail of data.details) {
      if (detail.orderedQuantity <= 0) throw new Error(`Ordered quantity for ${detail.productName} must be positive.`);
      if (detail.unitPrice < 0) throw new Error(`Unit price for ${detail.productName} cannot be negative.`);
      newProductsSubtotal += detail.orderedQuantity * detail.unitPrice;
    }
    const newTotalAmount = newProductsSubtotal + (data.additionalCosts?.reduce((sum, cost) => sum + cost.amount, 0) || 0);

    const mainPOUpdateData: Partial<PurchaseOrder> & { [key: string]: any } = { // Using any for deleteField compatibility
      notes: data.notes ?? currentPOData.notes,
      expectedDeliveryDate: data.expectedDeliveryDate ?? currentPOData.expectedDeliveryDate,
      additionalCosts: data.additionalCosts,
      productsSubtotal: newProductsSubtotal,
      totalAmount: newTotalAmount,
      updatedAt: Timestamp.now(),
    };

    // Store current details as original if not already stored
    if (!currentPOData.originalDetails && (currentPOData.status === "ChangesProposedBySupplier" || currentPOData.status === "SentToSupplier")) {
      const originalDetailsSnapshot = await getPODetailsInTransaction(poId, transaction);
      mainPOUpdateData.originalDetails = originalDetailsSnapshot;
      mainPOUpdateData.originalAdditionalCosts = currentPOData.additionalCosts;
      mainPOUpdateData.originalProductsSubtotal = currentPOData.productsSubtotal;
      mainPOUpdateData.originalTotalAmount = currentPOData.totalAmount;
      mainPOUpdateData.originalNotes = currentPOData.notes;
      mainPOUpdateData.originalExpectedDeliveryDate = currentPOData.expectedDeliveryDate;
    }
    
    transaction.update(poRef, mainPOUpdateData);

    // Delete old details and add new ones
    const detailsCollectionRef = collection(poRef, "details");
    const oldDetailsQuery = query(detailsCollectionRef);
    const oldDetailsSnap = await getDocs(oldDetailsQuery); // This read is fine before writes in tx if just for refs
    
    for (const docSnap of oldDetailsSnap.docs) {
      transaction.delete(docSnap.ref);
    }

    data.details.forEach(newDetailData => {
      const detailRef = doc(detailsCollectionRef); 
      const poDetail: Omit<PurchaseOrderDetail, "id"> = {
        productId: newDetailData.productId,
        productName: newDetailData.productName,
        orderedQuantity: newDetailData.orderedQuantity,
        receivedQuantity: 0, 
        receivedDamagedQuantity: 0,
        receivedMissingQuantity: 0,
        unitPrice: newDetailData.unitPrice,
        subtotal: newDetailData.orderedQuantity * newDetailData.unitPrice,
        notes: newDetailData.notes,
      };
      transaction.set(detailRef, poDetail);
    });
  });
};

export const updatePurchaseOrderStatus = async (
  poId: string,
  newStatus: PurchaseOrderStatus,
  userId: string
): Promise<void> => {
  const poRef = doc(db, "purchaseOrders", poId);
  const now = Timestamp.now();
  
  const originalPO = await getPurchaseOrderById(poId); 
  if (!originalPO) {
    throw new Error(`Purchase Order ${poId} not found for status update.`);
  }
  const originalStatus = originalPO.status;

  const updateData: Partial<PurchaseOrder> & { [key: string]: any } = {
    status: newStatus,
    updatedAt: now,
  };

  if ((newStatus === "Completed" || newStatus === "Canceled" || newStatus === "RejectedBySupplier") && !originalPO.completionDate) {
    updateData.completionDate = now;
  }

  // If confirming, clear original details if they exist, as the current state is now the confirmed state
  if (newStatus === "ConfirmedBySupplier" && originalPO.originalDetails) {
    updateData.originalDetails = deleteField();
    updateData.originalAdditionalCosts = deleteField();
    updateData.originalProductsSubtotal = deleteField();
    updateData.originalTotalAmount = deleteField();
    updateData.originalNotes = deleteField();
    updateData.originalExpectedDeliveryDate = deleteField();
  }

  if (newStatus === "ConfirmedBySupplier" && originalPO.details) {
    // Fetch potentially updated details (e.g., if a revert happened just before this call)
    const currentDetailsForConfirmation = await getPODetails(poId);
    await updateRequisitionQuantitiesPostConfirmation(poId, userId, currentDetailsForConfirmation);
  } else if (
      (newStatus === "Canceled" && (originalStatus === "Pending" || originalStatus === "SentToSupplier" || originalStatus === "ChangesProposedBySupplier" || originalStatus === "PendingInternalReview")) ||
      (newStatus === "RejectedBySupplier" && (originalStatus === "SentToSupplier" || originalStatus === "ChangesProposedBySupplier" || originalStatus === "PendingInternalReview"))
    ) {
    // Use originalPO.details as these are the quantities that were *pending*
    if (originalPO.details && originalPO.details.length > 0) {
        await handleRequisitionUpdateForPOCancellation(originalPO.originRequisitionId, originalPO.details, userId);
    } else {
        console.warn(`PO ${poId} details not found or empty when attempting to update requisition for Canceled/RejectedBySupplier status. Requisition may not be correctly updated.`);
    }
  }

  await updateDoc(poRef, updateData);
};

export interface RecordSupplierSolutionData {
  supplierAgreedSolutionType: SupplierSolutionType;
  supplierAgreedSolutionDetails: string;
}

export const recordSupplierSolution = async (
  poId: string,
  solutionData: RecordSupplierSolutionData,
  userId: string 
): Promise<void> => {
  const poRef = doc(db, "purchaseOrders", poId);
  const now = Timestamp.now();

  const updatePayload: Partial<PurchaseOrder> & { [key: string]: any } = {
    supplierAgreedSolutionType: solutionData.supplierAgreedSolutionType,
    supplierAgreedSolutionDetails: solutionData.supplierAgreedSolutionDetails,
    updatedAt: now,
  };

  let newStatus: PurchaseOrderStatus | undefined = undefined;
  switch (solutionData.supplierAgreedSolutionType) {
    case "FutureDelivery":
      newStatus = "AwaitingFutureDelivery";
      break;
    case "CreditPartialCharge":
    case "DiscountForImperfection":
    case "Other": 
      newStatus = "Completed";
      updatePayload.completionDate = now; 
      break;
  }

  if (newStatus) {
    updatePayload.status = newStatus;
  }
  
  await updateDoc(poRef, updatePayload);

  // If solution moves PO to "Completed", we might need to call updateRequisitionQuantitiesPostConfirmation
  // to ensure all requisition states are finalized based on what was actually received vs resolved.
  if (newStatus === "Completed") {
      const currentDetailsForCompletion = await getPODetails(poId);
      await updateRequisitionQuantitiesPostConfirmation(poId, userId, currentDetailsForCompletion, true /* indicate it's a final completion */);
  }
};
