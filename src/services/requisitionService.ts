
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
  runTransaction
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Requisition, RequiredProduct as RequisitionRequiredProduct, RequisitionStatus, QuotationStatus } from "@/types";
import { getUserById } from "./userService";
import type { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page";

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
  userId: string
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting processAndFinalizeAwards for requisitionId: "${requisitionId}" with ${selectedAwards.length} selected awards. User: ${userId}`);

  if (!requisitionId || typeof requisitionId !== 'string' || requisitionId.trim() === '') {
    const errorMsg = `[RequisitionService] processAndFinalizeAwards: Invalid requisitionId: '${requisitionId}'`;
    console.error(errorMsg);
    return { success: false, message: "Invalid Requisition ID provided." };
  }

  // --- Phase 1: Pre-fetch data OUTSIDE the transaction ---
  let initialRequiredProductsList: RequisitionRequiredProduct[];
  try {
    console.log(`[RequisitionService] Pre-fetching required products for requisitionId: ${requisitionId}`);
    initialRequiredProductsList = await getRequiredProductsForRequisition(requisitionId);
    console.log(`[RequisitionService] Successfully pre-fetched ${initialRequiredProductsList.length} required products.`);
  } catch (error: any) {
    console.error(`[RequisitionService] Error pre-fetching required products for ${requisitionId}:`, error);
    return { success: false, message: `Failed to pre-fetch required products: ${error.message}` };
  }

  if (initialRequiredProductsList.length === 0 && selectedAwards.length > 0) {
      console.warn(`[RequisitionService] Requisition ${requisitionId} has no initial required products listed, but awards are being processed. This might indicate an issue.`);
  }

  // Create a map for easy lookup of initial required product data by productId
  const requiredProductsMap = new Map<string, { id: string; data: RequisitionRequiredProduct }>();
  initialRequiredProductsList.forEach(rp => {
    if (rp.productId) {
      requiredProductsMap.set(rp.productId, { id: rp.id, data: rp });
    } else {
      console.warn(`[RequisitionService] Pre-fetch: RequiredProduct document ${rp.id} in requisition ${requisitionId} is missing 'productId'.`);
    }
  });
  console.log(`[RequisitionService] Built requiredProductsMap with ${requiredProductsMap.size} entries from pre-fetched data.`);

  try {
    await runTransaction(db, async (transaction) => {
      console.log(`[RequisitionService] Transaction started for requisitionId: ${requisitionId}`);
      const now = Timestamp.now();

      // --- Phase 2: Perform ALL transactional READS upfront ---
      const requisitionRef = doc(db, "requisitions", requisitionId);
      console.log(`[RequisitionService] Reading requisition document: ${requisitionRef.path}`);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      const requisitionDataFromTransaction = requisitionSnap.data();
      console.log(`[RequisitionService] Successfully read requisition ${requisitionId} (Status: ${requisitionDataFromTransaction.status})`);

      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
      console.log(`[RequisitionService] Reading all quotations for requisition ${requisitionId}`);
      const allQuotationsSnap = await transaction.get(allQuotationsForRequisitionQuery);
      console.log(`[RequisitionService] Successfully read ${allQuotationsSnap.size} quotations for requisition ${requisitionId}`);

      // --- Phase 3: Perform ALL calculations and logic (NO MORE TRANSACTIONAL READS) ---
      const awardedQuotationIds = new Set<string>();
      selectedAwards.forEach(award => awardedQuotationIds.add(award.quotationId));

      // Calculate projected purchased quantities based on initial state and selected awards
      const projectedPurchases = new Map<string, number>();
      initialRequiredProductsList.forEach(initialRP => {
        let currentProjectedQty = initialRP.data.purchasedQuantity || 0;
        const awardForThisProduct = selectedAwards.find(sa => sa.productId === initialRP.productId);
        if (awardForThisProduct) {
          currentProjectedQty += awardForThisProduct.awardedQuantity;
        }
        projectedPurchases.set(initialRP.productId, currentProjectedQty);
      });
      console.log(`[RequisitionService] Calculated projected purchases:`, projectedPurchases);


      // Determine new requisition status
      let allRequirementsMet = true;
      if (initialRequiredProductsList.length === 0) {
        console.log(`[RequisitionService] Requisition ${requisitionId}: No products were initially required. Considering all requirements met.`);
        allRequirementsMet = true;
      } else {
        for (const initialRP of initialRequiredProductsList) {
          const projectedQty = projectedPurchases.get(initialRP.productId) || 0;
          if (projectedQty < initialRP.data.requiredQuantity) {
            allRequirementsMet = false;
            console.log(`[RequisitionService] Requisition ${requisitionId}: Product ${initialRP.productId} not fully met. Required: ${initialRP.data.requiredQuantity}, Projected: ${projectedQty}`);
            break;
          }
        }
      }

      let newRequisitionStatus: RequisitionStatus = requisitionDataFromTransaction.status as RequisitionStatus;
      if (selectedAwards.length > 0 || newRequisitionStatus === "Quoted" || newRequisitionStatus === "Pending Quotation") {
          if (allRequirementsMet) {
              newRequisitionStatus = "Completed";
              console.log(`[RequisitionService] All requirements met for ${requisitionId}. Setting status to "Completed".`);
          } else {
              newRequisitionStatus = "PO in Progress";
              console.log(`[RequisitionService] Some requirements pending for ${requisitionId}. Setting status to "PO in Progress".`);
          }
      } else {
          console.log(`[RequisitionService] No awards made, or requisition status (${newRequisitionStatus}) doesn't warrant change based on awards alone.`);
      }


      // --- Phase 4: Perform ALL transactional WRITES ---
      console.log(`[RequisitionService] Staging update for requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });

      for (const award of selectedAwards) {
        const reqProductEntry = requiredProductsMap.get(award.productId);
        if (!reqProductEntry) {
          console.warn(`[RequisitionService] During write phase: Required product with ProductID ${award.productId} not found in pre-fetched map for requisition ${requisitionId}. Skipping update for this item.`);
          continue;
        }

        const reqProductDocRef = doc(db, `requisitions/${requisitionId}/requiredProducts/${reqProductEntry.id}`);
        const finalPurchasedQuantity = (reqProductEntry.data.purchasedQuantity || 0) + award.awardedQuantity;

        console.log(`[RequisitionService] Staging update for requiredProduct ${reqProductEntry.id} (ProductID: ${award.productId}): purchasedQuantity to ${finalPurchasedQuantity}`);
        transaction.update(reqProductDocRef, { purchasedQuantity: finalPurchasedQuantity });

        const quotationRef = doc(db, "cotizaciones", award.quotationId);
        console.log(`[RequisitionService] Staging update for quotation ${award.quotationId} status to "Awarded".`);
        transaction.update(quotationRef, { status: "Awarded" as QuotationStatus, updatedAt: now });
      }

      allQuotationsSnap.forEach(quoteDoc => {
        const quoteData = quoteDoc.data();
        if ((quoteData.status === "Received" || quoteData.status === "Partially Awarded") && !awardedQuotationIds.has(quoteDoc.id)) {
          console.log(`[RequisitionService] Staging update for quotation ${quoteDoc.id} (Status: ${quoteData.status}) to "Lost".`);
          transaction.update(quoteDoc.ref, { status: "Lost" as QuotationStatus, updatedAt: now });
        }
      });

      console.log(`[RequisitionService] All writes for requisition ${requisitionId} staged successfully.`);
    }); // End of runTransaction

    console.log(`[RequisitionService] Transaction for requisitionId ${requisitionId} committed successfully.`);
    return { success: true, message: "Awards processed successfully and statuses updated." };

  } catch (error: any) {
    console.error(`[RequisitionService] Error in processAndFinalizeAwards for requisitionId ${requisitionId}:`, error);
    // Log the specific Firestore error code if available
    if (error.code) {
        console.error(`[RequisitionService] Firestore error code: ${error.code}`);
    }
    return { success: false, message: error.message || "Failed to process awards due to an unexpected error." };
  }
};

    