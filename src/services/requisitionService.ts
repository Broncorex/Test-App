
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
  userId: string 
): Promise<{ success: boolean; message?: string }> => {
  try {
    await runTransaction(db, async (transaction) => {
      const now = Timestamp.now();
      const requisitionRef = doc(db, "requisitions", requisitionId);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        throw new Error("Requisition not found.");
      }
      
      const requiredProductsQuery = query(collection(requisitionRef, "requiredProducts"));
      const requiredProductsSnapForInitialRead = await transaction.get(requiredProductsQuery);

      const requiredProductsMap = new Map<string, { id: string, data: RequisitionRequiredProduct }>();
      requiredProductsSnapForInitialRead.forEach(doc => requiredProductsMap.set(doc.data().productId, { id: doc.id, data: doc.data() as RequisitionRequiredProduct }));
      
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
        const quoteSnap = await transaction.get(quotationRef);
        if (quoteSnap.exists()) {
            const quoteData = quoteSnap.data() as Quotation;
            let newQuoteStatus: QuotationStatus = "Awarded";
            
            // Check if this quote can fulfill more for other products in the requisition
            // This requires knowing all quotationDetails for this quote.
            // For simplicity, if any part is awarded, mark as "Awarded".
            // A more complex logic might involve "Partially Awarded" if other items on the same quote remain unawarded.
            // This simplified logic sets to "Awarded" if any item from it is selected.
            
            // A quick check: if not all items from this specific quotation that were *part of this requisition* are awarded,
            // and *some* are, then it might be "Partially Awarded" for this specific requisition context.
            // However, the overall Quotation status might depend on other requisitions too if it's a general quote.
            // Let's keep it simple: if any part is awarded for *this* requisition, we consider the quote "Awarded" in context of this requisition.
            // If further refinement is needed for global quotation status, that's a larger topic.

            transaction.update(quotationRef, { status: newQuoteStatus, updatedAt: now });
        }
        awardedQuotationIds.add(award.quotationId);
      }

      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
      const allQuotationsSnap = await getDocs(allQuotationsForRequisitionQuery); 

      for (const quoteDoc of allQuotationsSnap.docs) {
        if ((quoteDoc.data().status === "Received" || quoteDoc.data().status === "Partially Awarded") && !awardedQuotationIds.has(quoteDoc.id)) {
          const quoteRefToUpdate = doc(db, "cotizaciones", quoteDoc.id);
          transaction.update(quoteRefToUpdate, { status: "Lost", updatedAt: now });
        }
      }
      
      // Determine new Requisition status
      const updatedRequiredProductsSnapAfterAwards = await transaction.get(requiredProductsQuery);
      let allRequirementsMet = true;
      if (updatedRequiredProductsSnapAfterAwards.empty && requiredProductsMap.size > 0) {
          allRequirementsMet = false; // If subcollection was unexpectedly empty but requisition had products.
      } else if (updatedRequiredProductsSnapAfterAwards.empty && requiredProductsMap.size === 0) {
          allRequirementsMet = true; // No products were required.
      } else {
          updatedRequiredProductsSnapAfterAwards.docs.forEach(docSnap => {
             const rp = docSnap.data() as RequisitionRequiredProduct;
             if ((rp.purchasedQuantity || 0) < rp.requiredQuantity) {
                 allRequirementsMet = false;
             }
          });
      }

      let newRequisitionStatus: RequisitionStatus = requisitionSnap.data().status; // Default to current
      if (selectedAwards.length > 0) { // Only change status if awards were made
        if (allRequirementsMet) {
          newRequisitionStatus = "Completed"; 
        } else {
          newRequisitionStatus = "PO in Progress"; // Placeholder for partial fulfillment
        }
      }
      
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });
    });

    return { success: true, message: "Awards processed successfully and statuses updated." };
  } catch (error: any) {
    console.error("Error processing awards:", error);
    return { success: false, message: error.message || "Failed to process awards." };
  }
};

