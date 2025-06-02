
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
    const errorMsg = `[RequisitionService] processAndFinalizeAwards: Invalid requisitionId: '${requisitionId}'`;
    console.error(errorMsg);
    return { success: false, message: "Invalid Requisition ID provided." };
  }

  // Step 1: Fetch initial required products data OUTSIDE the transaction
  let initialRequiredProductsList: RequisitionRequiredProduct[];
  try {
    console.log(`[RequisitionService] Pre-fetching required products for requisitionId: ${requisitionId}`);
    initialRequiredProductsList = await getRequiredProductsForRequisition(requisitionId);
    console.log(`[RequisitionService] Successfully pre-fetched ${initialRequiredProductsList.length} required products.`);
  } catch (error: any) {
    console.error(`[RequisitionService] Error pre-fetching required products for ${requisitionId}:`, error);
    return { success: false, message: `Failed to pre-fetch required products: ${error.message}` };
  }

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
      const requisitionRef = doc(db, "requisitions", requisitionId);
      
      console.log(`[RequisitionService] Attempting to read requisition document: ${requisitionRef.path} within transaction.`);
      const requisitionSnap = await transaction.get(requisitionRef);

      if (!requisitionSnap.exists()) {
        console.error(`[RequisitionService] Requisition ${requisitionId} not found within transaction.`);
        throw new Error("Requisition not found.");
      }
      const requisitionData = requisitionSnap.data();
      console.log(`[RequisitionService] Successfully fetched requisition ${requisitionId} within transaction. Status: ${requisitionData.status}`);
      
      const awardedQuotationIds = new Set<string>();

      for (const award of selectedAwards) {
        console.log(`[RequisitionService] Processing award for Product ID: ${award.productId}, Qty: ${award.awardedQuantity}, Supplier: ${award.supplierName} (Quote ID: ${award.quotationId})`);
        const reqProductEntry = requiredProductsMap.get(award.productId);
        
        if (!reqProductEntry) {
          console.warn(`[RequisitionService] Required product with ProductID ${award.productId} not found in pre-fetched map for requisition ${requisitionId}. Skipping award for this item.`);
          continue;
        }

        // Construct DocumentReference to the specific subcollection document
        const reqProductDocRef = doc(db, `requisitions/${requisitionId}/requiredProducts/${reqProductEntry.id}`);
        console.log(`[RequisitionService] Reference to update requiredProduct: ${reqProductDocRef.path}`);
        
        // Get current purchased quantity from pre-fetched data
        const currentPurchasedQty = reqProductEntry.data.purchasedQuantity || 0;
        const newPurchasedQuantity = currentPurchasedQty + award.awardedQuantity;

        console.log(`[RequisitionService] Updating requiredProduct ${reqProductEntry.id} (ProductID: ${award.productId}): purchasedQuantity from ${currentPurchasedQty} to ${newPurchasedQuantity}`);
        transaction.update(reqProductDocRef, { purchasedQuantity: newPurchasedQuantity });

        const quotationRef = doc(db, "cotizaciones", award.quotationId);
        console.log(`[RequisitionService] Marking quotation ${award.quotationId} as "Awarded". Path: ${quotationRef.path}`);
        transaction.update(quotationRef, { status: "Awarded" as QuotationStatus, updatedAt: now });
        awardedQuotationIds.add(award.quotationId);
      }
      console.log(`[RequisitionService] Processed ${selectedAwards.length} awards. Awarded quotation IDs: ${Array.from(awardedQuotationIds).join(', ')}`);

      const allQuotationsForRequisitionQuery = query(collection(db, "cotizaciones"), where("requisitionId", "==", requisitionId));
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
      
      // Re-read requiredProducts transactionally to determine final status
      const requiredProductsSubCollectionPath = `requisitions/${requisitionId}/requiredProducts`;
      console.log(`[RequisitionService] Re-evaluating requisition status. Path for required products subcollection: ${requiredProductsSubCollectionPath}`);
      
      const updatedRequiredProductsCollectionRef = collection(db, requiredProductsSubCollectionPath);
      const queryForUpdatedRequiredProducts = query(updatedRequiredProductsCollectionRef, orderBy("productName"));
      console.log(`[RequisitionService] Constructed queryForUpdatedRequiredProducts object:`, queryForUpdatedRequiredProducts);

      console.log(`[RequisitionService] Attempting to get updated requiredProducts for ${requisitionId}. Query Collection Path: ${requiredProductsSubCollectionPath}`);
      const updatedRequiredProductsSnapAfterAwards = await transaction.get(queryForUpdatedRequiredProducts); 
      console.log(`[RequisitionService] Successfully read ${updatedRequiredProductsSnapAfterAwards.size} updated requiredProduct documents for ${requisitionId}.`);
      
      updatedRequiredProductsSnapAfterAwards.forEach(docSnap => {
         console.log(`[RequisitionService] Updated Read - RequiredProduct Doc ID: ${docSnap.id}, Data:`, docSnap.data());
      });

      let allRequirementsMet = true;
      // Use the pre-fetched initialRequiredProductsList to know which products were originally required
      if (initialRequiredProductsList.length === 0) {
        console.log(`[RequisitionService] Requisition ${requisitionId}: No products were initially required. Considering all requirements met.`);
        allRequirementsMet = true;
      } else if (updatedRequiredProductsSnapAfterAwards.empty && initialRequiredProductsList.length > 0) {
          allRequirementsMet = false; 
          console.log(`[RequisitionService] Requisition ${requisitionId}: Not all requirements met (subcollection empty after updates, but products were initially required).`);
      } else {
          const updatedProductDataMap = new Map<string, RequisitionRequiredProduct>();
          updatedRequiredProductsSnapAfterAwards.forEach(docSnap => {
              const rp = docSnap.data() as RequisitionRequiredProduct;
              if(rp && rp.productId) {
                updatedProductDataMap.set(rp.productId, rp);
              }
          });

          for (const initialProduct of initialRequiredProductsList) {
            const updatedProduct = updatedProductDataMap.get(initialProduct.productId);
            if (!updatedProduct) { // Should not happen if updates were correct and product wasn't deleted
                console.warn(`[RequisitionService] Product ${initialProduct.productId} was in initial list but not found after updates. Assuming not met.`);
                allRequirementsMet = false;
                break;
            }
             if (!updatedProduct.requiredQuantity) {
                 console.warn(`[RequisitionService] Requisition ${requisitionId}: Updated Product ${updatedProduct.productId} data is missing 'requiredQuantity'. Assuming not met for safety.`);
                 allRequirementsMet = false;
                 break; 
             }
             if ((updatedProduct.purchasedQuantity || 0) < updatedProduct.requiredQuantity) {
                 allRequirementsMet = false;
                 console.log(`[RequisitionService] Requisition ${requisitionId}: Product ${updatedProduct.productId} (Doc ID: ${updatedProduct.id}) not fully met. Required: ${updatedProduct.requiredQuantity}, Purchased: ${updatedProduct.purchasedQuantity || 0}`);
                 break;
             }
          }
      }

      let newRequisitionStatus: RequisitionStatus = requisitionData.status as RequisitionStatus; 
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

    
