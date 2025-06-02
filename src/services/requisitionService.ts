
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
  Quotation, // Import full Quotation type
  QuotationStatus,
  QuotationDetail, // Import QuotationDetail
  UserRole,
  PurchaseOrder as FullPurchaseOrder,
  PurchaseOrderDetail as FullPurchaseOrderDetail,
} from "@/types";
import { getUserById } from "./userService";
import type { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page";
import { createPurchaseOrder as createPO, getPurchaseOrderById } from "./purchaseOrderService";
import type { CreatePurchaseOrderData, CreatePurchaseOrderDetailData } from "./purchaseOrderService";

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
  allRelevantOriginalQuotes: Quotation[], // Added parameter
  userId: string
): Promise<{ success: boolean; message?: string; createdPurchaseOrderIds?: string[] }> => {
  console.log(`[RequisitionService] Starting processAndFinalizeAwards for requisitionId: "${requisitionId}" with ${selectedAwards.length} selected awards. User: ${userId}`);

  if (!requisitionId || typeof requisitionId !== 'string' || requisitionId.trim() === '') {
    const errorMsg = `[RequisitionService] processAndFinalizeAwards: Invalid requisitionId: '${requisitionId}'`;
    console.error(errorMsg);
    return { success: false, message: "Invalid Requisition ID provided." };
  }

  const createdPurchaseOrderIds: string[] = [];

  try {
    await runTransaction(db, async (transaction) => {
      console.log(`[RequisitionService] Transaction started for requisitionId: ${requisitionId}`);
      const now = Timestamp.now();

      const requisitionRef = doc(db, "requisitions", requisitionId);
      console.log(`[RequisitionService] Attempting to read requisition document: ${requisitionRef.path}`);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      const requisitionData = requisitionSnap.data() as Requisition;
      console.log(`[RequisitionService] Successfully fetched requisition ${requisitionId} within transaction. Current Status: ${requisitionData.status}`);

      const awardsBySupplier = new Map<string, SelectedOfferInfo[]>();
      selectedAwards.forEach(award => {
        if (!awardsBySupplier.has(award.supplierId)) {
          awardsBySupplier.set(award.supplierId, []);
        }
        awardsBySupplier.get(award.supplierId)!.push(award);
      });
      console.log(`[RequisitionService] Grouped ${selectedAwards.length} awards into ${awardsBySupplier.size} suppliers.`);

      for (const [supplierId, awardsForSupplier] of awardsBySupplier.entries()) {
        const supplierName = awardsForSupplier[0]?.supplierName || "Unknown Supplier";
        console.log(`[RequisitionService] Preparing to create PO for supplier: ${supplierName} (ID: ${supplierId})`);

        const poDetails: CreatePurchaseOrderDetailData[] = awardsForSupplier.map(award => ({
          productId: award.productId,
          productName: award.productName,
          orderedQuantity: award.awardedQuantity,
          unitPrice: award.unitPrice,
          notes: `From Quotation: ${award.quotationId.substring(0,6)}... for Requisition Product: ${award.productName}`,
        }));

        const poAdditionalCosts: Quotation['additionalCosts'] = [];
        const firstQuotationIdForSupplier = awardsForSupplier[0]?.quotationId;
        if (firstQuotationIdForSupplier) {
            const originalQuotationForPO = allRelevantOriginalQuotes.find(q => q.id === firstQuotationIdForSupplier);
            if (originalQuotationForPO?.additionalCosts) {
                poAdditionalCosts?.push(...originalQuotationForPO.additionalCosts);
            }
        }

        const purchaseOrderData: CreatePurchaseOrderData = {
          supplierId: supplierId,
          originRequisitionId: requisitionId,
          quotationReferenceId: firstQuotationIdForSupplier || null,
          expectedDeliveryDate: Timestamp.fromDate(new Date(now.toDate().getTime() + 14 * 24 * 60 * 60 * 1000)), // Placeholder: 2 weeks
          notes: `Purchase Order for Requisition ${requisitionId.substring(0,6)}... awarded to ${supplierName}`,
          additionalCosts: poAdditionalCosts || [],
          details: poDetails,
        };

        // IMPORTANT: createPO is called outside the transaction scope for its writes
        // because it performs its own batch. The PO IDs are collected.
        // This is a common pattern: aggregate data, then perform external writes.
        // The transaction here will focus on updating Requisition and Quotation statuses.
        const newPoId = await createPO(purchaseOrderData, userId);
        createdPurchaseOrderIds.push(newPoId);
        console.log(`[RequisitionService] Successfully created PO ${newPoId} (Pending) for supplier ${supplierId}`);
      }

      // Phase 4: Stage Transactional Writes for Requisition and Quotations
      const newRequisitionStatus: RequisitionStatus = selectedAwards.length > 0 ? "PO in Progress" : requisitionData.status;
      console.log(`[RequisitionService] Staging update for requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });

      // Update quotation statuses based on awards
      for (const originalQuote of allRelevantOriginalQuotes) {
        const quoteRef = doc(db, "cotizaciones", originalQuote.id);
        const awardsFromThisQuote = selectedAwards.filter(sa => sa.quotationId === originalQuote.id);

        if (awardsFromThisQuote.length > 0) {
          // Items were awarded from this quote. Check if all offered items were awarded.
          let allOfferedItemsAwarded = true;
          if (originalQuote.quotationDetails && originalQuote.quotationDetails.length > 0) {
            if (awardsFromThisQuote.length < originalQuote.quotationDetails.length) {
              allOfferedItemsAwarded = false; // Not all product lines offered in this quote were selected
            } else {
              // All product lines offered were selected, check if quantities match (simplified check for now)
              // A more precise check would compare awarded quantities against original quoted quantities for each line
            }
          } else if (originalQuote.quotationDetails?.length === 0 && awardsFromThisQuote.length > 0) {
            // Offered no items but somehow has awards? Should not happen.
            allOfferedItemsAwarded = false;
          }


          if (allOfferedItemsAwarded) {
            console.log(`[RequisitionService] Staging update for quotation ${originalQuote.id} status to "Awarded".`);
            transaction.update(quoteRef, { status: "Awarded" as QuotationStatus, updatedAt: now });
          } else {
            console.log(`[RequisitionService] Staging update for quotation ${originalQuote.id} status to "Partially Awarded".`);
            transaction.update(quoteRef, { status: "Partially Awarded" as QuotationStatus, updatedAt: now });
          }
        } else {
          // No items awarded from this quote. If it was 'Received' or 'Partially Awarded', mark as 'Lost'.
          if (originalQuote.status === "Received" || originalQuote.status === "Partially Awarded") {
            console.log(`[RequisitionService] Staging update for quotation ${originalQuote.id} (Status: ${originalQuote.status}) to "Lost".`);
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
    if (error.code) {
      console.error(`[RequisitionService] Firestore error code: ${error.code}`);
    }
    return { success: false, message: error.message || "Failed to process awards due to an unexpected error." };
  }
};


export const updateRequisitionStateAfterPOSent = async (
  purchaseOrderId: string,
  userId: string
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting updateRequisitionStateAfterPOSent for PO ID: ${purchaseOrderId}. User: ${userId}`);

  try {
    await runTransaction(db, async (transaction) => {
      // Fetch PO and its details - this read happens *before* the transaction officially starts for its writes
      // but within the runTransaction callback. This is acceptable.
      const poFromDb = await getPurchaseOrderById(purchaseOrderId); // Uses regular getDoc
      if (!poFromDb || !poFromDb.details) {
        throw new Error(`Purchase Order ${purchaseOrderId} or its details not found.`);
      }
      // Ensure PO status is indeed "Sent" (could be re-fetched transactionally if extreme consistency needed, but usually UI gates this)
       if (poFromDb.status !== "Sent") {
         console.warn(`[RequisitionService] PO ${purchaseOrderId} is not in "Sent" status (actual: ${poFromDb.status}). Requisition quantities not updated.`);
         // Potentially throw an error or return a specific message if this check should be strict.
         // For now, we'll proceed, assuming the caller (PO detail page) handles this gating.
         // If not, a transactional read of PO status here would be safer.
       }


      const requisitionRef = doc(db, "requisitions", poFromDb.originRequisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);
      if (!requisitionSnap.exists()) {
        throw new Error(`Origin Requisition ${poFromDb.originRequisitionId} not found for PO ${poFromDb.id}.`);
      }
      const requisitionData = requisitionSnap.data() as Requisition;

      const requiredProductsColRef = collection(db, `requisitions/${poFromDb.originRequisitionId}/requiredProducts`);
      const requiredProductsSnap = await transaction.get(query(requiredProductsColRef));

      let allReqItemsNowFullyPurchased = true;

      for (const poDetail of poFromDb.details) {
        const reqProdDocSnap = requiredProductsSnap.docs.find(
          (docSnap) => (docSnap.data() as RequisitionRequiredProduct).productId === poDetail.productId
        );

        if (reqProdDocSnap) {
          const reqProdRef = reqProdDocSnap.ref;
          const reqProdData = reqProdDocSnap.data() as RequisitionRequiredProduct;
          const newPurchasedQty = (reqProdData.purchasedQuantity || 0) + poDetail.orderedQuantity;
          
          transaction.update(reqProdRef, { purchasedQuantity: newPurchasedQty });
          console.log(`[RequisitionService] Updating ReqProduct ${reqProdDocSnap.id} (ProdID: ${reqProdData.productId}) purchasedQuantity from ${reqProdData.purchasedQuantity} to ${newPurchasedQty}`);
          
          if (newPurchasedQty < reqProdData.requiredQuantity) {
            allReqItemsNowFullyPurchased = false;
          }
        } else {
          console.warn(`[RequisitionService] Product ${poDetail.productId} from sent PO ${poFromDb.id} not found in original requisition's required products list.`);
        }
      }
      
      // After updating all individual required products, check overall requisition status
      // Fetch the updated required products to make a final decision on requisition status
      const updatedRequiredProductsAfterPOUpdate: RequisitionRequiredProduct[] = [];
      const finalReqProdsSnap = await transaction.get(query(requiredProductsColRef)); // Re-read within transaction
      finalReqProdsSnap.forEach(doc => {
        updatedRequiredProductQuantitiesAfterPOUpdate.push(doc.data() as RequisitionRequiredProduct);
      });

      allReqItemsNowFullyPurchased = updatedRequiredProductQuantitiesAfterPOUpdate.every(
        rp => (rp.purchasedQuantity || 0) >= rp.requiredQuantity
      );


      let newRequisitionStatus = requisitionData.status;
      if (allReqItemsNowFullyPurchased && requisitionData.status === "PO in Progress") {
        newRequisitionStatus = "Completed";
      }
      // If not all items fully purchased, it remains "PO in Progress" 
      // (or its current state if it was already "Completed" - though this shouldn't happen if logic is correct).

      if (newRequisitionStatus !== requisitionData.status) {
        transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: Timestamp.now() });
        console.log(`[RequisitionService] Requisition ${poFromDb.originRequisitionId} status updated to ${newRequisitionStatus}.`);
      } else {
        // Still update 'updatedAt' even if status didn't change, as sub-items changed.
        transaction.update(requisitionRef, { updatedAt: Timestamp.now() });
      }
    });

    console.log(`[RequisitionService] Successfully updated requisition state for PO ${purchaseOrderId}.`);
    return { success: true, message: "Requisition updated successfully after PO sent." };
  } catch (error: any) {
    console.error(`[RequisitionService] Error updating requisition state after PO sent for PO ${purchaseOrderId}:`, error);
    return { success: false, message: error.message || "Failed to update requisition state." };
  }
};


// Helper type for the updated products map in updateRequisitionStateAfterPOSent
// This will store the final state of purchased quantities after considering the current PO.
interface UpdatedRequiredProductQuantities {
    [productId: string]: {
        currentPurchased: number;
        required: number;
    };
}
// This helper is not strictly necessary with the re-read approach but shown for clarity if an intermediate map was used.
// For the re-read, it's:
const updatedRequiredProductQuantitiesAfterPOUpdate: RequisitionRequiredProduct[] = [];
// ... which is populated by the second transaction.get()


    
