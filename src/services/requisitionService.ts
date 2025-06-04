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
  limit,
  writeBatch,
  QueryConstraint,
  collectionGroup,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
  QuerySnapshot
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Requisition,
  RequiredProduct as RequisitionRequiredProduct,
  RequisitionStatus,
  Quotation,
  QuotationStatus,
  QuotationDetail,
  UserRole,
  PurchaseOrder as FullPurchaseOrder,
  PurchaseOrderDetail as FullPurchaseOrderDetail,
} from "@/types";
import { getUserById } from "./userService";
import type { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page";
import { createPurchaseOrder as createPO, getPurchaseOrderById } from "./purchaseOrderService";
import type { CreatePurchaseOrderData, CreatePurchaseOrderDetailData } from "./purchaseOrderService";
import { isValid } from "date-fns"; // For validating dates

const requisitionsCollection = collection(db, "requisitions");

export interface RequisitionProductData {
  productId: string;
  productName: string;
  requiredQuantity: number;
  notes: string;
}

export interface CreateRequisitionData {
  notes: string;
  products: RequisitionProductData[];
}

export interface UpdateRequisitionData {
  status?: RequisitionStatus;
  notes?: string;
}

export interface RequisitionFilters {
  status?: RequisitionStatus;
  requestingUserId?: string;
}

export const createRequisition = async (data: CreateRequisitionData, userId: string, userName: string): Promise<string> => {
  const now = Timestamp.now();
  const batch = writeBatch(db);

  const requisitionRef = doc(requisitionsCollection);

  const requisitionData: Omit<Requisition, "id" | "requiredProducts" | "requestingUserName"> = {
    creationDate: now,
    requestingUserId: userId,
    status: "Pending Quotation",
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  };
  batch.set(requisitionRef, requisitionData);

  data.products.forEach(productData => {
    const requiredProductRef = doc(collection(requisitionRef, "requiredProducts"));
    const requiredProductEntry: Omit<RequisitionRequiredProduct, "id"> = {
      ...productData,
      purchasedQuantity: 0,
      pendingPOQuantity: 0, // Initialize pendingPOQuantity
    };
    batch.set(requiredProductRef, requiredProductEntry);
  });

  await batch.commit();
  return requisitionRef.id;
};

export const getRequisitionById = async (id: string): Promise<Requisition | null> => {
  if (!id) return null;
  const requisitionRef = doc(db, "requisitions", id);
  const requisitionSnap = await getDoc(requisitionRef);

  if (!requisitionSnap.exists()) {
    return null;
  }

  const requisitionData = { id: requisitionSnap.id, ...requisitionSnap.data() } as Requisition;

  if (requisitionData.requestingUserId) {
    const user = await getUserById(requisitionData.requestingUserId);
    requisitionData.requestingUserName = user?.displayName || requisitionData.requestingUserId;
  }

  requisitionData.requiredProducts = await getRequiredProductsForRequisition(id);

  return requisitionData;
};

export const getAllRequisitions = async (filters: RequisitionFilters = {}, currentUserId: string, currentUserRole: UserRole | null): Promise<Requisition[]> => {
  let qConstraints: QueryConstraint[] = [];

  if (currentUserRole === 'employee') {
    qConstraints.push(where("requestingUserId", "==", currentUserId));
  } else if (filters.requestingUserId) {
    qConstraints.push(where("requestingUserId", "==", filters.requestingUserId));
  }

  if (filters.status) {
    qConstraints.push(where("status", "==", filters.status));
  }

  qConstraints.push(orderBy("createdAt", "desc"));

  const q = query(requisitionsCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);

  const requisitionsPromises = querySnapshot.docs.map(async (docSnap) => {
    const reqData = { id: docSnap.id, ...docSnap.data() } as Requisition;
    if (reqData.requestingUserId) {
      const user = await getUserById(reqData.requestingUserId);
      reqData.requestingUserName = user?.displayName || reqData.requestingUserId;
    }
    return reqData;
  });

  return Promise.all(requisitionsPromises);
};

export const updateRequisitionStatus = async (id: string, status: RequisitionStatus): Promise<void> => {
  const requisitionRef = doc(db, "requisitions", id);
  await updateDoc(requisitionRef, {
    status: status,
    updatedAt: Timestamp.now(),
  });
};

export const updateRequisition = async (id: string, data: UpdateRequisitionData): Promise<void> => {
  const requisitionRef = doc(db, "requisitions", id);
  await updateDoc(requisitionRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
};

export const getRequiredProductsForRequisition = async (requisitionId: string): Promise<RequisitionRequiredProduct[]> => {
    const requiredProductsCollectionRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
    const q = query(requiredProductsCollectionRef, orderBy("productName"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as RequisitionRequiredProduct));
};

export const processAndFinalizeAwards = async (
  requisitionId: string,
  selectedAwards: SelectedOfferInfo[],
  allRelevantOriginalQuotes: Quotation[],
  userId: string
): Promise<{ success: boolean; message?: string; createdPurchaseOrderIds?: string[] }> => {
  console.log(`[RequisitionService] Starting processAndFinalizeAwards for requisitionId: "${requisitionId}" with ${selectedAwards.length} selected awards. User: ${userId}`);

  if (!requisitionId || typeof requisitionId !== 'string' || requisitionId.trim() === '') {
    const errorMsg = `[RequisitionService] processAndFinalizeAwards: Invalid requisitionId: '${requisitionId}'`;
    console.error(errorMsg);
    return { success: false, message: "Invalid Requisition ID provided." };
  }

  const createdPurchaseOrderIds: string[] = [];
  const poDetailsForPendingQtyUpdate: { productId: string, orderedQuantity: number }[] = [];

  try {
    const awardsBySupplier = new Map<string, SelectedOfferInfo[]>();
    selectedAwards.forEach(award => {
      if (!awardsBySupplier.has(award.supplierId)) {
        awardsBySupplier.set(award.supplierId, []);
      }
      awardsBySupplier.get(award.supplierId)!.push(award);
    });

    for (const [supplierId, awardsForSupplier] of awardsBySupplier.entries()) {
      const supplierName = awardsForSupplier[0]?.supplierName || "Unknown Supplier";
      console.log(`[RequisitionService] Preparing to create PO for supplier: ${supplierName} (ID: ${supplierId})`);

      const poDetails: CreatePurchaseOrderDetailData[] = awardsForSupplier.map(award => {
        const detail = {
          productId: award.productId,
          productName: award.productName,
          orderedQuantity: award.awardedQuantity,
          unitPrice: award.unitPrice,
          notes: `From Quotation: ${award.quotationId.substring(0,6)}... for Req Product: ${award.productName}`,
        };
        poDetailsForPendingQtyUpdate.push({ productId: award.productId, orderedQuantity: award.awardedQuantity });
        return detail;
      });

      const poAdditionalCosts: Quotation['additionalCosts'] = [];
      const firstQuotationIdForSupplier = awardsForSupplier[0]?.quotationId;
      if (firstQuotationIdForSupplier) {
          const originalQuotationForPO = allRelevantOriginalQuotes.find(q => q.id === firstQuotationIdForSupplier);
          if (originalQuotationForPO?.additionalCosts) {
              poAdditionalCosts?.push(...originalQuotationForPO.additionalCosts);
          }
      }
      
      const poItemEtas = awardsForSupplier
        .map(award => award.estimatedDeliveryDate)
        .filter(date => date instanceof Timestamp && isValid(date.toDate())) as Timestamp[];

      let finalExpectedDeliveryDate: Timestamp;
      if (poItemEtas.length > 0) {
          finalExpectedDeliveryDate = poItemEtas.reduce((max, current) => (current.toMillis() > max.toMillis() ? current : max), poItemEtas[0]);
          console.log(`[RequisitionService] Determined latest ETA for PO to supplier ${supplierId}: ${finalExpectedDeliveryDate.toDate().toISOString()}`);
      } else {
          finalExpectedDeliveryDate = Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)); // Fallback
          console.warn(`[RequisitionService] No valid ETAs found for PO to supplier ${supplierId}. Using default 14-day ETA.`);
      }

      const purchaseOrderData: CreatePurchaseOrderData = {
        supplierId: supplierId,
        originRequisitionId: requisitionId,
        quotationReferenceId: firstQuotationIdForSupplier || null,
        expectedDeliveryDate: finalExpectedDeliveryDate,
        notes: `Purchase Order for Requisition ${requisitionId.substring(0,6)}... awarded to ${supplierName}`,
        additionalCosts: poAdditionalCosts || [],
        details: poDetails,
      };
      const newPoId = await createPO(purchaseOrderData, userId); // POs are created with 'Pending' status
      createdPurchaseOrderIds.push(newPoId);
      console.log(`[RequisitionService] Successfully created PO ${newPoId} (Pending) for supplier ${supplierId}`);
    }

    await runTransaction(db, async (transaction) => {
      console.log(`[RequisitionService] Transaction started for requisitionId: ${requisitionId} to update statuses and pending quantities.`);
      const now = Timestamp.now();
      
      // Create document references properly within the transaction
      const requisitionRef = doc(db, "requisitions", requisitionId);
      
      // Get requisition within transaction
      const requisitionSnap = await transaction.get(requisitionRef);
      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      
      const requisitionData = requisitionSnap.data() as Requisition;
      console.log(`[RequisitionService] Fetched requisition ${requisitionId} within transaction. Status: ${requisitionData.status}`);

      // Get required products using individual document references
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();
      
      // First, get all required products outside transaction to get their IDs
      const requiredProductsColRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
      const requiredProductsSnapshot = await getDocs(requiredProductsColRef);
      
      // Now get each document within the transaction
      for (const docSnap of requiredProductsSnapshot.docs) {
        const docRef = doc(db, `requisitions/${requisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(docRef);
        
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: docRef, data });
        }
      }

      // Update pending quantities for each product
      for (const item of poDetailsForPendingQtyUpdate) {
        const reqProdInfo = requiredProductsMap.get(item.productId);
        if (reqProdInfo) {
          const newPendingPOQuantity = (reqProdInfo.data.pendingPOQuantity || 0) + item.orderedQuantity;
          transaction.update(reqProdInfo.ref, { pendingPOQuantity: newPendingPOQuantity });
          console.log(`[RequisitionService] Incremented pendingPOQuantity for product ${item.productId} on requisition ${requisitionId} by ${item.orderedQuantity} to ${newPendingPOQuantity}`);
        } else {
           console.warn(`[RequisitionService] Product ${item.productId} from new PO not found in requisition ${requisitionId} required products during pendingPOQuantity update.`);
        }
      }

      // Update requisition status
      const newRequisitionStatus: RequisitionStatus = selectedAwards.length > 0 ? "PO in Progress" : requisitionData.status;
      console.log(`[RequisitionService] Staging update for requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });

      // Update quotation statuses
      for (const originalQuote of allRelevantOriginalQuotes) {
        // Create proper document reference for each quotation
        const quoteRef = doc(db, "cotizaciones", originalQuote.id);
        const awardsFromThisQuote = selectedAwards.filter(sa => sa.quotationId === originalQuote.id);
        
        if (awardsFromThisQuote.length > 0) {
          let allOfferedItemsAwarded = true;
          if (originalQuote.quotationDetails && awardsFromThisQuote.length < originalQuote.quotationDetails.length) {
            allOfferedItemsAwarded = false;
          }
          const quoteStatusToSet = allOfferedItemsAwarded ? "Awarded" : "Partially Awarded";
          console.log(`[RequisitionService] Staging update for quotation ${originalQuote.id} status to "${quoteStatusToSet}".`);
          transaction.update(quoteRef, { status: quoteStatusToSet as QuotationStatus, updatedAt: now });
        } else {
          if (originalQuote.status === "Received" || originalQuote.status === "Partially Awarded") {
            console.log(`[RequisitionService] Staging update for quotation ${originalQuote.id} status to "Lost".`);
            transaction.update(quoteRef, { status: "Lost" as QuotationStatus, updatedAt: now });
          }
        }
      }
      console.log(`[RequisitionService] All transactional writes for requisition ${requisitionId} and its quotations staged successfully.`);
    });

    console.log(`[RequisitionService] Transaction for requisitionId ${requisitionId} committed successfully. Created POs: ${createdPurchaseOrderIds.join(', ')}`);
    return { success: true, message: "Awards processed and Purchase Orders created with 'Pending' status.", createdPurchaseOrderIds };

  } catch (error: any) {
    console.error(`[RequisitionService] Error in processAndFinalizeAwards for requisitionId ${requisitionId}:`, error);
    return { success: false, message: error.message || "Failed to process awards due to an unexpected error." };
  }
};

export const updateRequisitionQuantitiesPostConfirmation = async (
  purchaseOrderId: string,
  userId: string
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting updateRequisitionQuantitiesPostConfirmation for PO ID: ${purchaseOrderId}. User: ${userId}`);

  try {
    // Get PO data outside of transaction first
    const poFromDb = await getPurchaseOrderById(purchaseOrderId);
    if (!poFromDb || !poFromDb.details) {
      throw new Error(`Purchase Order ${purchaseOrderId} or its details not found.`);
    }
    
    if (poFromDb.status !== "ConfirmedBySupplier") {
       console.warn(`[RequisitionService] PO ${purchaseOrderId} is not in "ConfirmedBySupplier" status (actual: ${poFromDb.status}). Requisition quantities for purchased/pending not updated by this call.`);
       return { success: true, message: "PO not in ConfirmedBySupplier status, no update needed." };
    }

    await runTransaction(db, async (transaction) => {
      // Create proper document references
      const requisitionRef = doc(db, "requisitions", poFromDb.originRequisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);
      
      if (!requisitionSnap.exists()) {
        throw new Error(`Origin Requisition ${poFromDb.originRequisitionId} not found for PO ${poFromDb.id}.`);
      }
      
      const requisitionData = requisitionSnap.data() as Requisition;

      // Get required products - first fetch outside transaction to get IDs
      const requiredProductsColRef = collection(db, `requisitions/${poFromDb.originRequisitionId}/requiredProducts`);
      const requiredProductsSnapshot = await getDocs(requiredProductsColRef);
      
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();

      // Get each document within the transaction
      for (const docSnap of requiredProductsSnapshot.docs) {
        const docRef = doc(db, `requisitions/${poFromDb.originRequisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(docRef);
        
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: docRef, data });
        }
      }

      let allReqItemsNowFullyPurchasedOrExceeded = true;

      // Update quantities for each PO detail
      for (const poDetail of poFromDb.details || []) {
        const reqProdInfo = requiredProductsMap.get(poDetail.productId);

        if (reqProdInfo) {
          const currentReqProdData = reqProdInfo.data;
          const newPurchasedQty = (currentReqProdData.purchasedQuantity || 0) + poDetail.orderedQuantity;
          const newPendingPOQuantity = Math.max(0, (currentReqProdData.pendingPOQuantity || 0) - poDetail.orderedQuantity);

          transaction.update(reqProdInfo.ref, {
            purchasedQuantity: newPurchasedQty,
            pendingPOQuantity: newPendingPOQuantity
          });
          
          console.log(`[RequisitionService] Updated ReqProduct (ProdID: ${currentReqProdData.productId}): purchasedQty to ${newPurchasedQty}, pendingPOQuantity to ${newPendingPOQuantity}`);
          
          // Update local data for status check
          reqProdInfo.data.purchasedQuantity = newPurchasedQty;
          reqProdInfo.data.pendingPOQuantity = newPendingPOQuantity;

          if (newPurchasedQty < currentReqProdData.requiredQuantity) {
            allReqItemsNowFullyPurchasedOrExceeded = false;
          }
        } else {
          console.warn(`[RequisitionService] Product ${poDetail.productId} from confirmed PO ${poFromDb.id} not found in original requisition's required products list.`);
        }
      }
      
      // Check if all items are now fully purchased
      allReqItemsNowFullyPurchasedOrExceeded = Array.from(requiredProductsMap.values()).every(
        rpInfo => (rpInfo.data.purchasedQuantity || 0) >= rpInfo.data.requiredQuantity
      );

      // Update requisition status if needed
      let newRequisitionStatus = requisitionData.status;
      if (allReqItemsNowFullyPurchasedOrExceeded && (requisitionData.status === "PO in Progress" || requisitionData.status === "Quoted")) {
        newRequisitionStatus = "Completed";
      }

      if (newRequisitionStatus !== requisitionData.status) {
        transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: Timestamp.now() });
        console.log(`[RequisitionService] Requisition ${poFromDb.originRequisitionId} status updated to ${newRequisitionStatus}.`);
      } else {
        transaction.update(requisitionRef, { updatedAt: Timestamp.now() });
      }
    });

    console.log(`[RequisitionService] Successfully updated requisition state for PO ${purchaseOrderId} confirmation.`);
    return { success: true, message: "Requisition updated successfully after PO confirmation." };
  } catch (error: any) {
    console.error(`[RequisitionService] Error updating requisition state after PO confirmation for PO ${purchaseOrderId}:`, error);
    return { success: false, message: error.message || "Failed to update requisition state." };
  }
};

export const handleRequisitionUpdateForPOCancellation = async (
  requisitionId: string,
  canceledPODetails: FullPurchaseOrderDetail[],
  userId: string
): Promise<void> => {
  console.log(`[RequisitionService] Handling PO Cancellation/Rejection for Requisition ID: ${requisitionId}. User: ${userId}`);
  
  if (!requisitionId || !canceledPODetails || canceledPODetails.length === 0) {
    console.warn("[RequisitionService] Insufficient data for PO cancellation/rejection update on requisition.");
    return;
  }

  try {
    // Get required products outside transaction first
    const requiredProductsColRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
    const requiredProductsSnapshot = await getDocs(requiredProductsColRef);

    await runTransaction(db, async (transaction) => {
      const requisitionRef = doc(db, "requisitions", requisitionId);
      
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();
      
      // Get each document within the transaction
      for (const docSnap of requiredProductsSnapshot.docs) {
        const docRef = doc(db, `requisitions/${requisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(docRef);
        
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: docRef, data });
        }
      }

      // Update pending quantities for canceled PO details
      for (const poDetail of canceledPODetails) {
        const reqProdInfo = requiredProductsMap.get(poDetail.productId);

        if (reqProdInfo) {
          const currentReqProdData = reqProdInfo.data;
          const newPendingPOQuantity = Math.max(0, (currentReqProdData.pendingPOQuantity || 0) - poDetail.orderedQuantity);
          transaction.update(reqProdInfo.ref, { pendingPOQuantity: newPendingPOQuantity });
          console.log(`[RequisitionService] For POCancel/Reject: Decremented pendingPOQuantity for product ${poDetail.productId} on requisition ${requisitionId} by ${poDetail.orderedQuantity} to ${newPendingPOQuantity}`);
        } else {
          console.warn(`[RequisitionService] For POCancel/Reject: Product ${poDetail.productId} from canceled/rejected PO not found in requisition ${requisitionId}.`);
        }
      }
      
      transaction.update(requisitionRef, { updatedAt: Timestamp.now() });
    });
    
    console.log(`[RequisitionService] Successfully updated pending quantities for requisition ${requisitionId} due to PO cancellation/rejection.`);
  } catch (error: any) {
    console.error(`[RequisitionService] Error updating requisition for PO cancellation:`, error);
    throw error;
  }
};