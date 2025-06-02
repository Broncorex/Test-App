
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
  QuotationStatus,
  UserRole,
  PurchaseOrder as FullPurchaseOrder, // Use full type for clarity
  PurchaseOrderDetail as FullPurchaseOrderDetail, // Use full type
} from "@/types";
import { getUserById } from "./userService";
import type { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page";
import { createPurchaseOrder as createPO, getPurchaseOrderById } from "./purchaseOrderService"; // Import PO service
import type { CreatePurchaseOrderData, CreatePurchaseOrderDetailData } from "./purchaseOrderService"; // Import PO data types

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
  userId: string // User performing the finalization
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

      // --- Phase 1: Transactional Reads ---
      const requisitionRef = doc(db, "requisitions", requisitionId);
      console.log(`[RequisitionService] Attempting to read requisition document: ${requisitionRef.path}`);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      const requisitionData = requisitionSnap.data() as Requisition; // Cast to Requisition type
      console.log(`[RequisitionService] Successfully fetched requisition ${requisitionId} within transaction. Current Status: ${requisitionData.status}`);

      const allQuotationsForRequisitionQuery = query(
        collection(db, "cotizaciones"),
        where("requisitionId", "==", requisitionId),
        orderBy("createdAt")
      );
      console.log(`[RequisitionService] Reading all quotations for requisition ${requisitionId}`);
      const allQuotationsSnap: QuerySnapshot<DocumentData> = await transaction.get(allQuotationsForRequisitionQuery);
      console.log(`[RequisitionService] Successfully read ${allQuotationsSnap.size} quotations for requisition ${requisitionId}`);

      // --- Phase 2: Calculations and Logic (NO MORE TRANSACTIONAL READS) ---
      const awardsBySupplier = new Map<string, SelectedOfferInfo[]>();
      selectedAwards.forEach(award => {
        if (!awardsBySupplier.has(award.supplierId)) {
          awardsBySupplier.set(award.supplierId, []);
        }
        awardsBySupplier.get(award.supplierId)!.push(award);
      });

      console.log(`[RequisitionService] Grouped ${selectedAwards.length} awards into ${awardsBySupplier.size} suppliers.`);

      // --- Phase 3: Stage Writes for Purchase Orders (outside transaction, happens before this whole block commits) ---
      // This part is tricky because createPO involves its own batch.
      // For now, we'll assume createPO is NOT transactional with this parent transaction.
      // A more complex setup might involve passing the transaction object to createPO.
      // However, creating POs and then updating related docs is a common pattern.

      for (const [supplierId, awardsForSupplier] of awardsBySupplier.entries()) {
        const supplierName = awardsForSupplier[0]?.supplierName || "Unknown Supplier"; // Get supplier name from first award
        console.log(`[RequisitionService] Preparing to create PO for supplier: ${supplierName} (ID: ${supplierId})`);

        const poDetails: CreatePurchaseOrderDetailData[] = awardsForSupplier.map(award => ({
          productId: award.productId,
          productName: award.productName,
          orderedQuantity: award.awardedQuantity,
          unitPrice: award.unitPrice,
          notes: `From Quotation: ${award.quotationId.substring(0,6)}... for Requisition Product: ${award.productName}`, // Example note
        }));

        const poAdditionalCosts: QuotationAdditionalCost[] = [];
        const firstQuotationIdForSupplier = awardsForSupplier[0]?.quotationId;
        if (firstQuotationIdForSupplier) {
            const originalQuotationDoc = allQuotationsSnap.docs.find(qDoc => qDoc.id === firstQuotationIdForSupplier);
            if (originalQuotationDoc) {
                const originalQuotationData = originalQuotationDoc.data();
                if (originalQuotationData.additionalCosts && Array.isArray(originalQuotationData.additionalCosts)) {
                    poAdditionalCosts.push(...originalQuotationData.additionalCosts);
                }
            }
        }


        const purchaseOrderData: CreatePurchaseOrderData = {
          supplierId: supplierId,
          originRequisitionId: requisitionId,
          quotationReferenceId: firstQuotationIdForSupplier || null, // Assuming one quote per supplier award for simplicity here
          expectedDeliveryDate: Timestamp.fromDate(new Date(now.toDate().getTime() + 14 * 24 * 60 * 60 * 1000)), // Placeholder: 2 weeks from now
          notes: `Purchase Order for Requisition ${requisitionId.substring(0,6)}... awarded to ${supplierName}`,
          additionalCosts: poAdditionalCosts,
          details: poDetails,
        };

        // Create PO (this is an async call within the transaction loop, but it's not using the transaction object directly)
        // The PO creation itself will handle its own atomicity for header/details.
        const newPoId = await createPO(purchaseOrderData, userId);
        createdPurchaseOrderIds.push(newPoId);
        console.log(`[RequisitionService] Successfully created PO ${newPoId} for supplier ${supplierId}`);
      }


      // --- Phase 4: Stage Transactional Writes for Requisition and Quotations ---
      const newRequisitionStatus: RequisitionStatus = selectedAwards.length > 0 ? "PO in Progress" : requisitionData.status;
      console.log(`[RequisitionService] Staging update for requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });

      const awardedQuotationIds = new Set<string>(selectedAwards.map(award => award.quotationId));
      allQuotationsSnap.docs.forEach((quoteDoc: QueryDocumentSnapshot<DocumentData>) => {
        const quoteData = quoteDoc.data();
        if (awardedQuotationIds.has(quoteDoc.id)) {
          if (quoteData.status !== "Awarded") {
            console.log(`[RequisitionService] Staging update for quotation ${quoteDoc.id} status to "Awarded".`);
            transaction.update(quoteDoc.ref, { status: "Awarded" as QuotationStatus, updatedAt: now });
          }
        } else if (quoteData.status === "Received" || quoteData.status === "Partially Awarded") {
          console.log(`[RequisitionService] Staging update for quotation ${quoteDoc.id} (Status: ${quoteData.status}) to "Lost".`);
          transaction.update(quoteDoc.ref, { status: "Lost" as QuotationStatus, updatedAt: now });
        }
      });

      console.log(`[RequisitionService] All transactional writes for requisition ${requisitionId} and its quotations staged successfully.`);
    });

    console.log(`[RequisitionService] Transaction for requisitionId ${requisitionId} committed successfully. Created POs: ${createdPurchaseOrderIds.join(', ')}`);
    return { success: true, message: "Awards processed and Purchase Orders created.", createdPurchaseOrderIds };

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
  userId: string // User who marked PO as sent
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting updateRequisitionStateAfterPOSent for PO ID: ${purchaseOrderId}. User: ${userId}`);

  try {
    await runTransaction(db, async (transaction) => {
      const po = await getPurchaseOrderById(purchaseOrderId); // Fetch outside transaction for now
      if (!po || !po.details) {
        throw new Error(`Purchase Order ${purchaseOrderId} or its details not found.`);
      }
      if (po.status !== "Sent") { // Check against actual PO status from DB if needed, but frontend should gate this
         console.warn(`[RequisitionService] PO ${purchaseOrderId} is not in "Sent" status. Current status: ${po.status}. Skipping requisition quantity update.`);
         return; // Or throw error if strict
      }

      const requisitionRef = doc(db, "requisitions", po.originRequisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);
      if (!requisitionSnap.exists()) {
        throw new Error(`Origin Requisition ${po.originRequisitionId} not found for PO ${po.id}.`);
      }
      const requisitionData = requisitionSnap.data() as Requisition;

      // Fetch all required products for the requisition WITHIN the transaction
      const requiredProductsColRef = collection(db, `requisitions/${po.originRequisitionId}/requiredProducts`);
      const requiredProductsSnap = await transaction.get(query(requiredProductsColRef)); // Read all once

      let allReqItemsFullyPurchased = true;
      const updatedRequiredProductQuantities: Record<string, number> = {}; // productId -> newPurchasedQuantity

      // Initialize map with current purchased quantities
      requiredProductsSnap.docs.forEach(docSnap => {
        const reqProd = docSnap.data() as RequisitionRequiredProduct;
        updatedRequiredProductQuantities[reqProd.productId] = reqProd.purchasedQuantity || 0;
      });

      // Add quantities from the current PO being sent
      for (const poDetail of po.details) {
        if (updatedRequiredProductQuantities.hasOwnProperty(poDetail.productId)) {
          updatedRequiredProductQuantities[poDetail.productId] += poDetail.orderedQuantity;
        } else {
          // This case should ideally not happen if POs are correctly created from requisitions
          console.warn(`[RequisitionService] Product ${poDetail.productId} from PO ${po.id} not found in original requisition ${po.originRequisitionId}.`);
        }
      }
      
      // Update required product documents
      for (const reqDocSnap of requiredProductsSnap.docs) {
          const reqProduct = reqDocSnap.data() as RequisitionRequiredProduct;
          const reqProductRef = doc(db, `requisitions/${po.originRequisitionId}/requiredProducts/${reqDocSnap.id}`);
          const newPurchasedQty = updatedRequiredProductQuantities[reqProduct.productId];

          if (newPurchasedQty !== undefined && newPurchasedQty !== reqProduct.purchasedQuantity) {
            transaction.update(reqProductRef, { purchasedQuantity: newPurchasedQty });
            console.log(`[RequisitionService] Updating ReqProduct ${reqDocSnap.id} (ProdID: ${reqProduct.productId}) purchasedQuantity to ${newPurchasedQty}`);
          }

          if (newPurchasedQty < reqProduct.requiredQuantity) {
            allReqItemsFullyPurchased = false;
          }
      }

      // Update requisition status if necessary
      let newRequisitionStatus = requisitionData.status;
      if (allReqItemsFullyPurchased && requisitionData.status === "PO in Progress") {
        newRequisitionStatus = "Completed";
      }
      // If not all items fully purchased, it remains "PO in Progress" (or its current state if it was already "Completed" for some reason)

      if (newRequisitionStatus !== requisitionData.status) {
        transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: Timestamp.now() });
        console.log(`[RequisitionService] Requisition ${po.originRequisitionId} status updated to ${newRequisitionStatus}.`);
      } else {
        // Still update 'updatedAt' if quantities changed, even if status didn't
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

    