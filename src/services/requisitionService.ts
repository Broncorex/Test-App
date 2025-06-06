
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
  PurchaseOrderStatus, 
} from "@/types";
import { getUserById } from "./userService";
import type { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page";
import { createPurchaseOrder as createPO, getPurchaseOrderById } from "./purchaseOrderService";
import type { CreatePurchaseOrderData, CreatePurchaseOrderDetailData } from "./purchaseOrderService";
import { isValid } from "date-fns"; 

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
      pendingPOQuantity: 0, 
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
          finalExpectedDeliveryDate = Timestamp.fromDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)); 
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
      const newPoId = await createPO(purchaseOrderData, userId); 
      createdPurchaseOrderIds.push(newPoId);
      console.log(`[RequisitionService] Successfully created PO ${newPoId} (Pending) for supplier ${supplierId}`);
    }

    await runTransaction(db, async (transaction) => {
      console.log(`[RequisitionService] Transaction started for requisitionId: ${requisitionId} to update statuses and pending quantities.`);
      const now = Timestamp.now();
      
      const requisitionRef = doc(db, "requisitions", requisitionId);
      
      const requisitionSnap = await transaction.get(requisitionRef);
      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      
      const requisitionData = requisitionSnap.data() as Requisition;
      console.log(`[RequisitionService] Fetched requisition ${requisitionId} within transaction. Status: ${requisitionData.status}`);

      const requiredProductsColRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
      // Fetching requiredProducts outside transaction for IDs, then get each doc inside transaction
      const initialRequiredProductsSnapshot = await getDocs(requiredProductsColRef);
      
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();
      for (const docSnap of initialRequiredProductsSnapshot.docs) {
        const reqProdDocRef = doc(db, `requisitions/${requisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(reqProdDocRef); // Read within transaction
        
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: reqProdDocRef, data });
        }
      }

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

      const newRequisitionStatus: RequisitionStatus = selectedAwards.length > 0 ? "PO in Progress" : requisitionData.status;
      console.log(`[RequisitionService] Staging update for requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });

      for (const originalQuote of allRelevantOriginalQuotes) {
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
  requisitionId: string,
  poDetailsToProcess: FullPurchaseOrderDetail[],
  userId: string,
  poOriginalStatus?: PurchaseOrderStatus
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting updateRequisitionQuantitiesPostConfirmation for Requisition ID: ${requisitionId}. User: ${userId}. PO Original Status: ${poOriginalStatus}`);

  try {
    await runTransaction(db, async (transaction) => {
      const requisitionRef = doc(db, "requisitions", requisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);
      
      if (!requisitionSnap.exists()) {
        throw new Error(`Requisition ${requisitionId} not found.`);
      }
      const requisitionData = requisitionSnap.data() as Requisition;

      const requiredProductsColRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
      // Fetching requiredProducts outside transaction for IDs, then get each doc inside transaction
      const initialRequiredProductsSnapshot = await getDocs(requiredProductsColRef); 
      
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();
      for (const docSnap of initialRequiredProductsSnapshot.docs) {
        const reqProdDocRef = doc(db, `requisitions/${requisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(reqProdDocRef); // Read within transaction
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: reqProdDocRef, data });
        }
      }

      for (const poDetail of poDetailsToProcess) {
        const reqProdInfo = requiredProductsMap.get(poDetail.productId);

        if (reqProdInfo) {
          const currentReqProdData = reqProdInfo.data;
          
          const newPurchasedQty = (currentReqProdData.purchasedQuantity || 0) + (poDetail.receivedQuantity || 0);
          const newPendingPOQuantity = Math.max(0, (currentReqProdData.pendingPOQuantity || 0) - poDetail.orderedQuantity);

          transaction.update(reqProdInfo.ref, {
            purchasedQuantity: newPurchasedQty,
            pendingPOQuantity: newPendingPOQuantity
          });
          
          console.log(`[RequisitionService] ProdID: ${poDetail.productId} (Requisition: ${requisitionId}) - Updated purchasedQty to ${newPurchasedQty} (added ${poDetail.receivedQuantity || 0}), pendingPOQty to ${newPendingPOQuantity} (subtracted ${poDetail.orderedQuantity}). PO Item ordered: ${poDetail.orderedQuantity}, received OK: ${poDetail.receivedQuantity || 0}.`);
          
          // Update the local map for the completion check later
          reqProdInfo.data.purchasedQuantity = newPurchasedQty;
          reqProdInfo.data.pendingPOQuantity = newPendingPOQuantity;
        } else {
          console.warn(`[RequisitionService] Product ${poDetail.productId} from PO not found in requisition ${requisitionId} required products during post-confirmation update.`);
        }
      }
      
      let allReqItemsNowFullySatisfied = true;
      for (const reqProdEntry of requiredProductsMap.values()) {
        if ((reqProdEntry.data.purchasedQuantity || 0) < reqProdEntry.data.requiredQuantity) {
          allReqItemsNowFullySatisfied = false;
          break;
        }
      }
      
      let newRequisitionStatus = requisitionData.status;
      if (allReqItemsNowFullySatisfied) {
        if (requisitionData.status === "PO in Progress" || requisitionData.status === "Quoted" || requisitionData.status === "Pending Quotation") {
             newRequisitionStatus = "Completed";
        }
      }
      // If not all items are satisfied, the status might remain "PO in Progress" or "Quoted".
      // If PO was already 'Completed' or 'Canceled', Requisition status might not change further by this function alone.

      if (newRequisitionStatus !== requisitionData.status) {
        transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: Timestamp.now() });
        console.log(`[RequisitionService] Requisition ${requisitionId} status updated to ${newRequisitionStatus}.`);
      } else {
        // Even if status doesn't change, update the timestamp
        transaction.update(requisitionRef, { updatedAt: Timestamp.now() });
      }
    });

    console.log(`[RequisitionService] Successfully updated requisition state for Requisition ID: ${requisitionId} after PO confirmation/completion.`);
    return { success: true, message: "Requisition updated successfully." };
  } catch (error: any) {
    console.error(`[RequisitionService] Error updating requisition state for Requisition ID: ${requisitionId}:`, error);
    return { success: false, message: error.message || "Failed to update requisition state." };
  }
};

export const handleRequisitionUpdateForPOCancellation = async (
  requisitionId: string,
  canceledPODetails: FullPurchaseOrderDetail[],
  userId: string,
  poStatusBeforeCancellation: PurchaseOrderStatus 
): Promise<void> => {
  console.log(`[RequisitionService] Handling PO Cancellation/Rejection for Requisition ID: ${requisitionId}. User: ${userId}. PO Status before: ${poStatusBeforeCancellation}`);
  
  if (!requisitionId || !canceledPODetails || canceledPODetails.length === 0) {
    console.warn("[RequisitionService] Insufficient data for PO cancellation/rejection update on requisition.");
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const requisitionRef = doc(db, "requisitions", requisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);
      if (!requisitionSnap.exists()) {
        throw new Error(`Requisition ${requisitionId} not found during PO cancellation handling.`);
      }
      const requisitionData = requisitionSnap.data() as Requisition;

      const requiredProductsColRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
      // Fetching requiredProducts outside transaction for IDs, then get each doc inside transaction
      const initialRequiredProductsSnapshot = await getDocs(requiredProductsColRef);
      
      const requiredProductsMap = new Map<string, { ref: any, data: RequisitionRequiredProduct }>();
      for (const docSnap of initialRequiredProductsSnapshot.docs) {
        const reqProdDocRef = doc(db, `requisitions/${requisitionId}/requiredProducts`, docSnap.id);
        const transactionDocSnap = await transaction.get(reqProdDocRef); // Read within transaction
        if (transactionDocSnap.exists()) {
          const data = transactionDocSnap.data() as RequisitionRequiredProduct;
          requiredProductsMap.set(data.productId, { ref: reqProdDocRef, data });
        }
      }

      let anyPendingQtyIncreased = false;

      for (const poDetail of canceledPODetails) {
        const reqProdInfo = requiredProductsMap.get(poDetail.productId);

        if (reqProdInfo) {
          const currentReqProdData = reqProdInfo.data;
          let updatePayload: Partial<RequisitionRequiredProduct> = {};

          // If the PO was confirmed (meaning its quantities were considered 'ordered' and moved from pending to purchased for the requisition)
          // then cancellation should revert 'purchasedQuantity' (by received amount if it's complex, or ordered if simpler)
          // and potentially re-add to 'pendingPOQuantity' if the need still exists.
          // However, the prompt for Stage 3 primarily focuses on the flow *towards* completion.
          // The current logic is: if PO was 'ConfirmedBySupplier', it implies items were expected.
          // If cancelled *after* being 'ConfirmedBySupplier' or 'Completed' (by solution), we reduce purchased and restore pending.
          // If cancelled *before* 'ConfirmedBySupplier', we just reduce pending.

          if (poStatusBeforeCancellation === "ConfirmedBySupplier" || poStatusBeforeCancellation === "Completed" || poStatusBeforeCancellation === "FullyReceived" || poStatusBeforeCancellation === "AwaitingFutureDelivery" || poStatusBeforeCancellation === "PartiallyDelivered") {
            // This PO's quantities were effectively committed or partially received.
            // Reverting purchasedQuantity by what was *actually received and OK* from this PO item makes most sense.
            // And restoring the *ordered* quantity to pending if it was a cancellation of future expected items.
            // The problem is, at cancellation, we might not know how much was received *from this specific PO* if it was part of multiple.
            // Simpler: When a confirmed/completed PO is CANCELED, we reduce the `purchasedQuantity` by the amount this PO contributed (its `orderedQuantity`)
            // and add back the `orderedQuantity` to `pendingPOQuantity` because these items are now needed again from *somewhere*.
            // This assumes the "purchased" state was incremented by "ordered" quantity when PO was confirmed.
            // If "purchased" was incremented by "received" quantity, this logic needs refinement.
            // The current implementation of updateRequisitionQuantitiesPostConfirmation updates purchased by `poDetail.receivedQuantity`.

            // For simplicity of reversal, if a PO is Canceled:
            // 1. Reduce pendingPOQuantity by its orderedQuantity (this was done when PO was created).
            // 2. If PO was Confirmed/Completed:
            //    - purchasedQuantity was increased by receivedQuantity from this PO.
            //    - pendingPOQuantity was decreased by orderedQuantity from this PO.
            // If this PO is Canceled:
            //    - We should decrease purchasedQuantity by what this PO contributed (its receivedQuantity).
            //    - We should increase pendingPOQuantity by the remaining unfulfilled orderedQuantity of this PO (ordered - received).
            // This is getting complex. Let's stick to the logic from the service file.
            
            // Logic from existing `handleRequisitionUpdateForPOCancellation`:
            // If PO was ConfirmedBySupplier: it means `pendingPOQuantity` was already reduced by `orderedQuantity`,
            // and `purchasedQuantity` might have been increased (by `receivedQuantity` as per `updateRequisitionQuantitiesPostConfirmation`).
            // Now, if it's CANCELED:
            // - `purchasedQuantity` should be reduced by `poDetail.receivedQuantity` (what this PO actually contributed to "purchased").
            // - `pendingPOQuantity` should be *increased* by `poDetail.orderedQuantity - poDetail.receivedQuantity` (the amount that was ordered but now won't come from this PO).

            // Let's simplify for the direct instruction: if the PO was `ConfirmedBySupplier` (or similar active states)
            // and now it's `Canceled`, it implies items that were thought to be secured are no longer.
            // So, we revert the `pendingPOQuantity` reduction and potentially adjust `purchasedQuantity`.

            // Current code's logic: if 'ConfirmedBySupplier', revert `purchasedQuantity` by `orderedQuantity` and add `orderedQuantity` to `pending`.
            // This assumes `purchasedQuantity` was incremented by `orderedQuantity`.
            // But `updateRequisitionQuantitiesPostConfirmation` increments `purchasedQuantity` by `receivedQuantity`.
            // This is a mismatch.

            // Let's follow the Stage 3 guidance: "decrease its pendingPOQuantity ... subtract poDetail.orderedQuantity" for completion.
            // For cancellation, the reverse would be to *increase* pendingPOQuantity by `poDetail.orderedQuantity` if those items are now needed again.
            // And decrease `purchasedQuantity` by `poDetail.receivedQuantity` if items were received then PO was retroactively cancelled.

            // Re-evaluating for cancellation of a PO that *was* considered confirmed/affecting requisition:
            // `pendingPOQuantity` should increase by `(poDetail.orderedQuantity - (poDetail.receivedQuantity || 0) - (poDetail.receivedDamagedQuantity || 0) - (poDetail.receivedMissingQuantity || 0))`
            // This is the *net outstanding amount* from this PO that is now being canceled.
            // `purchasedQuantity` should decrease by `(poDetail.receivedQuantity || 0)`.

            const netOutstandingFromThisPO = poDetail.orderedQuantity - 
                                             (poDetail.receivedQuantity || 0) - 
                                             (poDetail.receivedDamagedQuantity || 0) -
                                             (poDetail.receivedMissingQuantity || 0);

            if (poStatusBeforeCancellation === "ConfirmedBySupplier" || poStatusBeforeCancellation === "Completed" || poStatusBeforeCancellation === "FullyReceived" || poStatusBeforeCancellation === "PartiallyDelivered" || poStatusBeforeCancellation === "AwaitingFutureDelivery") {
                updatePayload.purchasedQuantity = Math.max(0, (currentReqProdData.purchasedQuantity || 0) - (poDetail.receivedQuantity || 0));
                updatePayload.pendingPOQuantity = (currentReqProdData.pendingPOQuantity || 0) + Math.max(0, netOutstandingFromThisPO);
                 anyPendingQtyIncreased = true;
            } else { // PO was canceled before it was 'ConfirmedBySupplier' or further (e.g. from Pending, SentToSupplier)
                // In this case, pendingPOQuantity was increased when the PO was created. Now it should be decreased.
                updatePayload.pendingPOQuantity = Math.max(0, (currentReqProdData.pendingPOQuantity || 0) - poDetail.orderedQuantity);
            }
            console.log(`[RequisitionService] For POCancel (ProdID: ${poDetail.productId}): PO old status ${poStatusBeforeCancellation}. Updated purchasedQty to ${updatePayload.purchasedQuantity}, pendingPOQty to ${updatePayload.pendingPOQuantity}`);
          } else { // PO was canceled *before* confirmation or any active processing.
             updatePayload.pendingPOQuantity = Math.max(0, (currentReqProdData.pendingPOQuantity || 0) - poDetail.orderedQuantity);
             console.log(`[RequisitionService] For POCancel (ProdID: ${poDetail.productId}): PO was not confirmed. Reverted pendingPOQty by ${poDetail.orderedQuantity} to ${updatePayload.pendingPOQuantity}`);
          }
          transaction.update(reqProdInfo.ref, updatePayload);
        } else {
          console.warn(`[RequisitionService] For POCancel/Reject: Product ${poDetail.productId} from canceled/rejected PO not found in requisition ${requisitionId}.`);
        }
      }
      
      let newRequisitionStatus = requisitionData.status;
      if (anyPendingQtyIncreased && (requisitionData.status === "Completed" || requisitionData.status === "PO in Progress")) {
          // If pending quantities increased due to cancellation, the requisition might no longer be 'Completed' or 'PO in Progress'
          // and might need to revert to 'Quoted' or 'Pending Quotation' if no other POs cover the need.
          // This check is complex as it requires knowing the state of *other* POs for this requisition.
          // For now, if pending quantities increase and it was completed, set it back to "PO in Progress" or "Quoted"
          // to signify it needs attention. "Quoted" is safer if we are unsure.
          newRequisitionStatus = "Quoted"; 
          console.log(`[RequisitionService] PO Cancellation resulted in increased pending need. Requisition ${requisitionId} status changed to ${newRequisitionStatus}.`);
      }


      if (newRequisitionStatus !== requisitionData.status) {
        transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: Timestamp.now() });
      } else {
        transaction.update(requisitionRef, { updatedAt: Timestamp.now() });
      }
    });
    
    console.log(`[RequisitionService] Successfully updated quantities for requisition ${requisitionId} due to PO cancellation/rejection.`);
  } catch (error: any) {
    console.error(`[RequisitionService] Error updating requisition for PO cancellation:`, error);
    throw error; 
  }
};
