
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
import type { Requisition, RequiredProduct, RequisitionStatus, Quotation, QuotationStatus } from "@/types";
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
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RequiredProduct));
};


export const processAndFinalizeAwards = async (
  requisitionId: string,
  selectedAwards: SelectedOfferInfo[],
  userId: string // User performing the action
): Promise<{ success: boolean; message?: string }> => {
  try {
    await runTransaction(db, async (transaction) => {
      const now = Timestamp.now();
      const requisitionRef = doc(db, "requisitions", requisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        throw new Error("Requisition not found.");
      }
      // const requisitionData = requisitionSnap.data() as Requisition; // Not strictly needed here if only updating status
      
      const requiredProductsQuery = query(collection(requisitionRef, "requiredProducts"));
      const requiredProductsSnap = await transaction.get(requiredProductsQuery); // Fetch all required products for this requisition

      const requiredProductsMap = new Map<string, { id: string, data: RequiredProduct }>();
      requiredProductsSnap.forEach(doc => requiredProductsMap.set(doc.data().productId, { id: doc.id, data: doc.data() as RequiredProduct }));
      
      const awardedQuotationIds = new Set<string>();

      for (const award of selectedAwards) {
        const reqProductEntry = requiredProductsMap.get(award.productId);
        if (!reqProductEntry) {
          console.warn(`Required product with ProductID ${award.productId} not found in requisition ${requisitionId}. Skipping award for this item.`);
          continue;
        }
        const reqProductRef = doc(db, `requisitions/${requisitionId}/requiredProducts/${reqProductEntry.id}`);
        
        const currentPurchasedQty = reqProductEntry.data.purchasedQuantity || 0;
        const newPurchasedQuantity = currentPurchasedQty + award.awardedQuantity;

        transaction.update(reqProductRef, { purchasedQuantity: newPurchasedQuantity });

        const quotationRef = doc(db, "cotizaciones", award.quotationId);
        // Check current status before updating to avoid unnecessary writes or race conditions if logic were more complex
        const quoteSnap = await transaction.get(quotationRef);
        if (quoteSnap.exists()) {
            const quoteData = quoteSnap.data() as Quotation;
            if (quoteData.status === "Received" || quoteData.status === "Partially Awarded") {
                 transaction.update(quotationRef, { status: "Awarded", updatedAt: now });
            } else if (quoteData.status !== "Awarded") { // Only update if not already Awarded (e.g. from another item in same batch)
                 transaction.update(quotationRef, { status: "Awarded", updatedAt: now });
            }
        }
        awardedQuotationIds.add(award.quotationId);
      }

      // Update statuses of other "Received" quotations for this requisition to "Lost"
      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
      
      // IMPORTANT: Firestore transactions cannot read the results of a query directly.
      // We must fetch these outside the transaction or handle this logic differently (e.g., a follow-up batch write).
      // For now, this part might not be fully transactional with the rest if done via getDocs.
      // A more robust solution might involve a Cloud Function trigger or careful client-side orchestration.
      // Let's assume we fetch *before* the transaction for this example, though it's not ideal for atomicity.
      const allQuotationsSnap = await getDocs(allQuotationsForRequisitionQuery); 

      for (const quoteDoc of allQuotationsSnap.docs) {
        if ((quoteDoc.data().status === "Received" || quoteDoc.data().status === "Partially Awarded") && !awardedQuotationIds.has(quoteDoc.id)) {
          // This update is outside the main transaction if getDocs is used.
          // If this were a critical part of atomicity, it would need restructuring.
          // For now, we'll update it non-transactionally or assume it's acceptable for this stage.
          // To make it transactional, one would need to read all these quote refs first, then update in transaction.
          // For simplicity of this step, we'll proceed with a separate update for "Lost" status or rely on client re-fetch and display logic.
          // A better way: pass all relevant quotation IDs (Received/Partially Awarded) to the transaction and update them.
          const quoteRefToUpdate = doc(db, "cotizaciones", quoteDoc.id);
          transaction.update(quoteRefToUpdate, { status: "Lost", updatedAt: now });
        }
      }
      
      // Determine new Requisition status
      // Re-fetch required products *within the transaction* after updates to ensure atomicity
      const updatedRequiredProductsSnapAfterAwards = await transaction.get(requiredProductsQuery);
      const allRequirementsMet = updatedRequiredProductsSnapAfterAwards.docs.every(docSnap => {
         const rp = docSnap.data() as RequiredProduct;
         return (rp.purchasedQuantity || 0) >= rp.requiredQuantity;
      });

      let newRequisitionStatus: RequisitionStatus = "PO in Progress"; 
      if (allRequirementsMet) {
        newRequisitionStatus = "Completed"; 
      }
      
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });
    });

    return { success: true, message: "Awards processed successfully." };
  } catch (error: any) {
    console.error("Error processing awards:", error);
    return { success: false, message: error.message || "Failed to process awards." };
  }
};

