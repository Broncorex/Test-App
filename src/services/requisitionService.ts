
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
import type { Requisition, RequiredProduct, RequisitionStatus, Quotation, QuotationStatus, RequisitionRequiredProduct } from "@/types";
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
    const requiredProductEntry: Omit<RequiredProduct, "id"> = {
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

  const requiredProductsCollectionRef = collection(requisitionRef, "requiredProducts");
  const requiredProductsSnap = await getDocs(query(requiredProductsCollectionRef, orderBy("productName")));
  
  requisitionData.requiredProducts = requiredProductsSnap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as RequiredProduct));

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

export const getRequiredProductsForRequisition = async (requisitionId: string): Promise<RequiredProduct[]> => {
    const requiredProductsCollectionRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
    const q = query(requiredProductsCollectionRef, orderBy("productName"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as RequiredProduct));
};


export const processAndFinalizeAwards = async (
  requisitionId: string,
  selectedAwards: SelectedOfferInfo[],
  userId: string 
): Promise<{ success: boolean; message?: string }> => {
  console.log(`[RequisitionService] Starting processAndFinalizeAwards for requisitionId: "${requisitionId}" with ${selectedAwards.length} selected awards. User: ${userId}`);

  if (!requisitionId || typeof requisitionId !== 'string' || requisitionId.trim() === '') {
    console.error("[RequisitionService] processAndFinalizeAwards: Invalid requisitionId:", requisitionId);
    return { success: false, message: "Invalid Requisition ID provided." };
  }

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
      console.log(`[RequisitionService] Successfully fetched requisition ${requisitionId} within transaction. Status: ${requisitionSnap.data().status}`);
      
      // Use requisitionSnap.ref for robust subcollection pathing
      const requiredProductsSubCollectionRef = collection(requisitionSnap.ref, "requiredProducts");
      console.log(`[RequisitionService] Path to requiredProducts (using requisitionSnap.ref): ${requiredProductsSubCollectionRef.path}`);
      const requiredProductsQuery = query(requiredProductsSubCollectionRef);
      
      console.log(`[RequisitionService] Attempting to get requiredProducts for ${requisitionId}. Query Collection Path: ${requiredProductsSubCollectionRef.path}`);
      const requiredProductsSnapForInitialRead = await transaction.get(requiredProductsQuery);
      console.log(`[RequisitionService] Successfully read ${requiredProductsSnapForInitialRead.size} requiredProduct documents for ${requisitionId}.`);

      const requiredProductsMap = new Map<string, { id: string; data: RequisitionRequiredProduct }>();
      requiredProductsSnapForInitialRead.forEach(docSnap => {
        const productData = docSnap.data() as RequisitionRequiredProduct;
        if (productData && productData.productId) {
            requiredProductsMap.set(productData.productId, { id: docSnap.id, data: productData });
        } else {
            console.warn(`[RequisitionService] RequiredProduct document ${docSnap.id} in requisition ${requisitionId} is missing 'productId' field or data.`);
        }
      });
      console.log(`[RequisitionService] Built requiredProductsMap with ${requiredProductsMap.size} entries.`);
      
      const awardedQuotationIds = new Set<string>();

      for (const award of selectedAwards) {
        console.log(`[RequisitionService] Processing award for Product ID: ${award.productId}, Qty: ${award.awardedQuantity}, Supplier: ${award.supplierName} (Quote ID: ${award.quotationId})`);
        const reqProductEntry = requiredProductsMap.get(award.productId);
        
        if (!reqProductEntry) {
          console.warn(`[RequisitionService] Required product with ProductID ${award.productId} not found in requisition ${requisitionId}. Skipping award for this item.`);
          continue;
        }

        const reqProductRef = doc(db, `requisitions/${requisitionId}/requiredProducts/${reqProductEntry.id}`);
        const currentPurchasedQty = reqProductEntry.data.purchasedQuantity || 0;
        const newPurchasedQuantity = currentPurchasedQty + award.awardedQuantity;

        console.log(`[RequisitionService] Updating requiredProduct ${reqProductEntry.id} (ProductID: ${award.productId}): purchasedQuantity from ${currentPurchasedQty} to ${newPurchasedQuantity}`);
        transaction.update(reqProductRef, { purchasedQuantity: newPurchasedQuantity });

        const quotationRef = doc(db, "cotizaciones", award.quotationId);
        // const quoteSnap = await transaction.get(quotationRef); // Reading quote inside loop can be costly for many awards. Assume status update is fine.
        // if (quoteSnap.exists()) { } // Already checked its existence implicitly by being in selectedAwards.
        console.log(`[RequisitionService] Marking quotation ${award.quotationId} as "Awarded".`);
        transaction.update(quotationRef, { status: "Awarded" as QuotationStatus, updatedAt: now });
        awardedQuotationIds.add(award.quotationId);
      }
      console.log(`[RequisitionService] Processed ${selectedAwards.length} awards. Awarded quotation IDs: ${Array.from(awardedQuotationIds).join(', ')}`);

      // Mark unawarded "Received" or "Partially Awarded" quotations as "Lost"
      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
      // This get is outside the main transaction logic for 'requiredProducts' but needed for other quotes.
      // For better transactional integrity, these quote refs would ideally be fetched *before* the transaction
      // or the list of all relevant quotes passed into the transaction.
      // For now, this subsequent get and updates are outside the main atomicity of the requiredProduct updates.
      // This is a common pattern if the number of quotes could be very large.
      // Let's attempt to read and update within the transaction for consistency.
      console.log(`[RequisitionService] Fetching all quotations for requisition ${requisitionId} to mark others as "Lost".`);
      const allQuotationsSnap = await transaction.get(allQuotationsForRequisitionQuery); 
      console.log(`[RequisitionService] Found ${allQuotationsSnap.size} total quotations for requisition ${requisitionId}.`);

      allQuotationsSnap.forEach(quoteDoc => {
        const quoteData = quoteDoc.data();
        if ((quoteData.status === "Received" || quoteData.status === "Partially Awarded") && !awardedQuotationIds.has(quoteDoc.id)) {
          console.log(`[RequisitionService] Marking quotation ${quoteDoc.id} (Status: ${quoteData.status}) as "Lost".`);
          const quoteRefToUpdate = doc(db, "cotizaciones", quoteDoc.id);
          transaction.update(quoteRefToUpdate, { status: "Lost" as QuotationStatus, updatedAt: now });
        }
      });
      
      // Re-evaluate requisition status after updates
      console.log(`[RequisitionService] Re-evaluating requisition status for ${requisitionId}.`);
      // Fetch the updated requiredProducts again within the same transaction
      const updatedRequiredProductsSnapAfterAwards = await transaction.get(requiredProductsQuery);
      console.log(`[RequisitionService] Fetched ${updatedRequiredProductsSnapAfterAwards.size} requiredProducts again for status check.`);

      let allRequirementsMet = true;
      if (updatedRequiredProductsSnapAfterAwards.empty && requiredProductsMap.size > 0) { // If subcollection became empty but was not initially.
          allRequirementsMet = false; 
          console.log(`[RequisitionService] Requisition ${requisitionId}: Not all requirements met (subcollection empty, but expected products).`);
      } else if (updatedRequiredProductsSnapAfterAwards.empty && requiredProductsMap.size === 0) { // No products were ever required
          allRequirementsMet = true; 
          console.log(`[RequisitionService] Requisition ${requisitionId}: No products were required initially.`);
      } else {
          updatedRequiredProductsSnapAfterAwards.docs.forEach(docSnap => {
             const rp = docSnap.data() as RequisitionRequiredProduct;
             if ((rp.purchasedQuantity || 0) < rp.requiredQuantity) {
                 allRequirementsMet = false;
                 console.log(`[RequisitionService] Requisition ${requisitionId}: Product ${rp.productId} not fully met. Required: ${rp.requiredQuantity}, Purchased: ${rp.purchasedQuantity || 0}`);
             }
          });
      }

      let newRequisitionStatus: RequisitionStatus = requisitionSnap.data().status as RequisitionStatus; 
      if (selectedAwards.length > 0 || newRequisitionStatus === "Quoted") { // If any award was processed or it was just quoted
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
      
      console.log(`[RequisitionService] Finalizing requisition ${requisitionId} status to: ${newRequisitionStatus}`);
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });
      console.log(`[RequisitionService] Transaction for ${requisitionId} completed successfully.`);
    });

    return { success: true, message: "Awards processed successfully and statuses updated." };
  } catch (error: any) {
    console.error(`[RequisitionService] Error in processAndFinalizeAwards for requisitionId ${requisitionId}:`, error);
    return { success: false, message: error.message || "Failed to process awards." };
  }
};
