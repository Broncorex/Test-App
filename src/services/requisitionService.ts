
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
import { SelectedOfferInfo } from "@/app/(app)/requisitions/[id]/compare-quotations/page"; // Import from page

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
      const requisitionData = requisitionSnap.data() as Requisition;
      
      // Store the original required products to avoid re-fetching inside loop
      const requiredProductsSnap = await transaction.get(query(collection(requisitionRef, "requiredProducts")));
      const originalRequiredProducts = requiredProductsSnap.docs.map(d => ({ id: d.id, ...d.data() } as RequiredProduct));

      const awardedQuotationIds = new Set<string>();

      for (const award of selectedAwards) {
        const reqProductToUpdate = originalRequiredProducts.find(rp => rp.productId === award.productId);
        if (!reqProductToUpdate) {
          console.warn(`Required product with ID ${award.productId} not found in requisition. Skipping award.`);
          continue;
        }
        const reqProductRef = doc(db, `requisitions/${requisitionId}/requiredProducts/${reqProductToUpdate.id}`);
        
        // Get current purchased quantity
        const currentReqProductSnap = await transaction.get(reqProductRef);
        const currentPurchasedQty = currentReqProductSnap.exists() ? (currentReqProductSnap.data()?.purchasedQuantity || 0) : 0;
        
        const newPurchasedQuantity = currentPurchasedQty + award.awardedQuantity;
        transaction.update(reqProductRef, { purchasedQuantity: newPurchasedQuantity });

        // Mark quotation as Awarded
        const quotationRef = doc(db, "cotizaciones", award.quotationId);
        transaction.update(quotationRef, { status: "Awarded", updatedAt: now });
        awardedQuotationIds.add(award.quotationId);
      }

      // Update statuses of other "Received" quotations for this requisition to "Lost"
      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
      const allQuotationsSnap = await getDocs(allQuotationsForRequisitionQuery); // Use getDocs, not transaction.get for query

      for (const quoteDoc of allQuotationsSnap.docs) {
        if (quoteDoc.data().status === "Received" && !awardedQuotationIds.has(quoteDoc.id)) {
          transaction.update(quoteDoc.ref, { status: "Lost", updatedAt: now });
        }
      }
      
      // Determine new Requisition status
      const updatedRequiredProductsSnap = await transaction.get(query(collection(requisitionRef, "requiredProducts")));
      const allRequirementsMet = updatedRequiredProductsSnap.docs.every(docSnap => {
         const rp = docSnap.data() as RequiredProduct;
         return rp.purchasedQuantity >= rp.requiredQuantity;
      });

      let newRequisitionStatus: RequisitionStatus = "PO in Progress"; // Default if any award made
      if (allRequirementsMet) {
        newRequisitionStatus = "Completed"; // Or "PO In Progress" if that's the next step before completion
      }
      
      transaction.update(requisitionRef, { status: newRequisitionStatus, updatedAt: now });
    });

    return { success: true, message: "Awards processed successfully." };
  } catch (error: any) {
    console.error("Error processing awards:", error);
    return { success: false, message: error.message || "Failed to process awards." };
  }
};
