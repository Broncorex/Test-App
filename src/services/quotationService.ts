
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
  writeBatch,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Quotation,
  QuotationDetail,
  QuotationStatus,
  QuotationAdditionalCost,
  RequiredProduct,
} from "@/types";
import { getRequisitionById } from "./requisitionService";
import { getSupplierById } from "./supplierService";
import { getUserById } from "./userService"; // Corrected import path
import { getProductById } from "./productService";

const quotationsCollection = collection(db, "cotizaciones"); // Using "cotizaciones" as per PRD

/*
Conceptual Firestore Security Rules for /cotizaciones collection:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function getUserData(userId) {
      if (userId == null) { return null; }
      return get(/databases/$(database)/documents/users/$(userId)).data;
    }

    function isAuthenticatedAndActive() {
      if (request.auth == null || request.auth.uid == null) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData != null && userData.isActive == true;
    }

    function isOwnerOrRelatedToRequisition(docData, userId) {
      // Check if user owns the quotation or the requisition it links to
      let requisition = get(/databases/$(database)/documents/requisitions/$(docData.requisitionId)).data;
      return docData.generatedByUserId == userId || requisition.requestingUserId == userId;
    }

    function isAdminOrSuperAdmin() {
      if (!isAuthenticatedAndActive()) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData.role == 'admin' || userData.role == 'superadmin';
    }

    match /cotizaciones/{quotationId} {
      allow read: if isAuthenticatedAndActive() && (isAdminOrSuperAdmin() || isOwnerOrRelatedToRequisition(resource.data, request.auth.uid));
      allow create: if isAuthenticatedAndActive() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.generatedByUserId == request.auth.uid &&
                       request.resource.data.status == "Sent" && // Initial status when requesting
                       request.resource.data.requisitionId != null &&
                       request.resource.data.supplierId != null &&
                       request.resource.data.responseDeadline != null;
      allow update: if isAuthenticatedAndActive() && isAdminOrSuperAdmin();
                      // Employees might update notes, or link POs under specific status conditions

      // quotationDetails subcollection rules
      match /quotationDetails/{detailId} {
        allow read: if isAuthenticatedAndActive() && (isAdminOrSuperAdmin() || isOwnerOrRelatedToRequisition(get(/databases/$(database)/documents/cotizaciones/$(quotationId)).data, request.auth.uid));
        allow create: if isAuthenticatedAndActive() && isAdminOrSuperAdmin(); // Details typically added via createQuotation or receiveQuotation
        allow update: if isAuthenticatedAndActive() && isAdminOrSuperAdmin();
        allow delete: if isAuthenticatedAndActive() && isAdminOrSuperAdmin();
      }
    }
  }
}

Conceptual Firestore Indexes for /cotizaciones:
- (requisitionId, status)
- (supplierId, status)
- (status, requestDate Desc)
- (generatedByUserId, requestDate Desc)
*/

export interface CreateQuotationRequestData {
  requisitionId: string;
  supplierId: string;
  responseDeadline: Timestamp;
  notes: string; // General notes for the request
}

export interface ReceivedQuotationItemData {
  productId: string;
  productName: string; // Denormalized
  requiredQuantity: number; // From original requisition
  quotedQuantity: number;
  unitPriceQuoted: number;
  conditions: string;
  estimatedDeliveryDate: Timestamp;
  notes: string;
}
export interface UpdateReceivedQuotationData {
  receivedDate: Timestamp;
  productsSubtotal: number;
  additionalCosts?: QuotationAdditionalCost[];
  totalQuotation: number;
  shippingConditions: string;
  notes: string; // Notes related to the received quotation
  details: ReceivedQuotationItemData[];
}

export interface QuotationFilters {
  requisitionId?: string;
  supplierId?: string;
  status?: QuotationStatus;
  // Add date range filters, etc.
}

const calculateTotalQuotation = (
  productsSubtotal: number,
  additionalCosts?: QuotationAdditionalCost[]
): number => {
  let total = productsSubtotal;
  if (additionalCosts) {
    total += additionalCosts.reduce((sum, cost) => sum + cost.amount, 0);
  }
  return total;
};


export const createQuotation = async (data: CreateQuotationRequestData, userId: string): Promise<string> => {
  const batch = writeBatch(db);
  const now = Timestamp.now();

  // 1. Validate Requisition and Supplier
  const requisition = await getRequisitionById(data.requisitionId);
  if (!requisition || !requisition.requiredProducts || requisition.requiredProducts.length === 0) {
    throw new Error("Requisition not found, is invalid, or has no products.");
  }
  if (requisition.status !== "Pending Quotation" && requisition.status !== "Quoted") {
    // Allow creating new quotes if already quoted to other suppliers.
    // But not if PO in progress, completed, or canceled.
    if (["PO in Progress", "Completed", "Canceled"].includes(requisition.status)) {
        throw new Error(`Cannot request quotations for a requisition with status: ${requisition.status}.`);
    }
  }

  const supplier = await getSupplierById(data.supplierId);
  if (!supplier || !supplier.isActive) {
    throw new Error("Supplier not found or is not active.");
  }

  const generatingUser = await getUserById(userId);
  if (!generatingUser) {
    throw new Error("Generating user not found.");
  }

  // 2. Create Quotation Header
  const quotationRef = doc(quotationsCollection);
  const quotationData: Omit<Quotation, "id" | "quotationDetails" | "supplierName" | "generatedByUserName"> = {
    requisitionId: data.requisitionId,
    supplierId: data.supplierId,
    requestDate: now,
    responseDeadline: data.responseDeadline,
    status: "Sent", // Initial status
    notes: data.notes,
    generatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    // productsSubtotal, additionalCosts, totalQuotation, shippingConditions, receivedDate are set upon reception
  };
  batch.set(quotationRef, quotationData);

  // 3. Create QuotationDetail subcollection items based on requisition.requiredProducts
  const quotationDetailsCollectionRef = collection(quotationRef, "quotationDetails");
  for (const reqProduct of requisition.requiredProducts) {
    const detailRef = doc(quotationDetailsCollectionRef);
    const productInfo = await getProductById(reqProduct.productId);
    if(!productInfo || !productInfo.isActive){
        console.warn(`Product ID ${reqProduct.productId} from requisition is not found or inactive. Skipping for quotation detail.`);
        continue;
    }

    const detailData: Omit<QuotationDetail, "id"> = {
      productId: reqProduct.productId,
      productName: reqProduct.productName, // Use denormalized name from requisition
      requiredQuantity: reqProduct.requiredQuantity,
      quotedQuantity: 0, // Supplier will fill this
      unitPriceQuoted: 0, // Supplier will fill this
      conditions: "", // Supplier will fill this
      estimatedDeliveryDate: data.responseDeadline, // Placeholder, supplier to confirm/update
      notes: "", // Supplier can add notes per item
    };
    batch.set(detailRef, detailData);
  }

  await batch.commit();

  // Update requisition status to "Quoted" if it was "Pending Quotation"
  if (requisition.status === "Pending Quotation") {
    const requisitionDocRef = doc(db, "requisitions", data.requisitionId);
    await updateDoc(requisitionDocRef, { status: "Quoted", updatedAt: Timestamp.now() });
  }

  return quotationRef.id;
};


export const getQuotationById = async (id: string): Promise<Quotation | null> => {
  if (!id) return null;
  const quotationRef = doc(db, "cotizaciones", id);
  const quotationSnap = await getDoc(quotationRef);

  if (!quotationSnap.exists()) {
    return null;
  }
  const data = quotationSnap.data() as Omit<Quotation, "id" | "quotationDetails">;

  // Denormalize supplier and user names
  let supplierName: string | undefined;
  let generatedByUserName: string | undefined;

  if (data.supplierId) {
    const supplier = await getSupplierById(data.supplierId);
    supplierName = supplier?.name;
  }
  if (data.generatedByUserId) {
    const user = await getUserById(data.generatedByUserId);
    generatedByUserName = user?.displayName;
  }

  const quotationDetailsCollectionRef = collection(quotationRef, "quotationDetails");
  const detailsSnap = await getDocs(query(quotationDetailsCollectionRef, orderBy("productName")));
  const quotationDetails: QuotationDetail[] = detailsSnap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as QuotationDetail));

  return {
    id: quotationSnap.id,
    ...data,
    supplierName,
    generatedByUserName,
    quotationDetails,
  };
};


export const getAllQuotations = async (filters: QuotationFilters = {}): Promise<Quotation[]> => {
  let qConstraints: QueryConstraint[] = [];

  if (filters.requisitionId) {
    qConstraints.push(where("requisitionId", "==", filters.requisitionId));
  }
  if (filters.supplierId) {
    qConstraints.push(where("supplierId", "==", filters.supplierId));
  }
  if (filters.status) {
    qConstraints.push(where("status", "==", filters.status));
  }
  qConstraints.push(orderBy("requestDate", "desc"));

  const q = query(quotationsCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);

  const quotationsPromises = querySnapshot.docs.map(async (docSnap) => {
    const data = docSnap.data() as Omit<Quotation, "id" | "supplierName" | "generatedByUserName" | "quotationDetails">;
    let supplierName: string | undefined;
    let generatedByUserName: string | undefined;

    if (data.supplierId) {
      const supplier = await getSupplierById(data.supplierId);
      supplierName = supplier?.name;
    }
    if (data.generatedByUserId) {
      const user = await getUserById(data.generatedByUserId);
      generatedByUserName = user?.displayName;
    }
    // Note: quotationDetails are not typically fetched in a list view for performance.
    // They would be fetched when viewing a specific quotation's details.
    return {
      id: docSnap.id,
      ...data,
      supplierName,
      generatedByUserName,
    } as Quotation;
  });

  return Promise.all(quotationsPromises);
};


export const updateQuotation = async (id: string, data: Partial<Omit<Quotation, "id" | "createdBy" | "createdAt" | "quotationDetails">>): Promise<void> => {
  const quotationRef = doc(db, "cotizaciones", id);
  // Ensure not to update fields like createdBy, createdAt
  const { createdBy, createdAt, quotationDetails, ...updateData } = data as any;

  if (updateData.productsSubtotal !== undefined && updateData.additionalCosts !== undefined) {
    updateData.totalQuotation = calculateTotalQuotation(updateData.productsSubtotal, updateData.additionalCosts);
  } else if (updateData.productsSubtotal !== undefined) {
     const currentQuotation = await getQuotationById(id);
     if (currentQuotation) {
        updateData.totalQuotation = calculateTotalQuotation(updateData.productsSubtotal, currentQuotation.additionalCosts);
     }
  } else if (updateData.additionalCosts !== undefined) {
    const currentQuotation = await getQuotationById(id);
     if (currentQuotation && currentQuotation.productsSubtotal !== undefined) {
        updateData.totalQuotation = calculateTotalQuotation(currentQuotation.productsSubtotal, updateData.additionalCosts);
     }
  }

  await updateDoc(quotationRef, {
    ...updateData,
    updatedAt: Timestamp.now(),
  });
};

export const receiveQuotation = async (id: string, data: UpdateReceivedQuotationData, userId: string): Promise<void> => {
  const quotationRef = doc(db, "cotizaciones", id);
  const batch = writeBatch(db);

  const quotationSnap = await getDoc(quotationRef);
  if (!quotationSnap.exists()) {
    throw new Error("Quotation to update not found.");
  }
  const currentQuotationData = quotationSnap.data() as Quotation;

  if (currentQuotationData.status !== "Sent" && currentQuotationData.status !== "Received") {
     throw new Error(`Cannot update received details for quotation with status: ${currentQuotationData.status}.`);
  }
  
  const calculatedSubtotal = data.details.reduce((sum, item) => sum + (item.quotedQuantity * item.unitPriceQuoted), 0);
  if (calculatedSubtotal !== data.productsSubtotal) {
    console.warn(`Provided productsSubtotal ${data.productsSubtotal} does not match calculated ${calculatedSubtotal}. Using calculated value.`);
  }

  const totalQuotation = calculateTotalQuotation(calculatedSubtotal, data.additionalCosts);

  // Update main quotation document
  const mainUpdateData: Partial<Quotation> = {
    status: "Received",
    receivedDate: data.receivedDate,
    productsSubtotal: calculatedSubtotal,
    additionalCosts: data.additionalCosts || [],
    totalQuotation: totalQuotation,
    shippingConditions: data.shippingConditions,
    notes: data.notes, // This will overwrite previous notes, consider if merging is needed
    updatedAt: Timestamp.now(),
  };
  batch.update(quotationRef, mainUpdateData);

  // Update/Create quotationDetails
  const quotationDetailsCollectionRef = collection(quotationRef, "quotationDetails");
  // First, fetch existing details to know which ones to update vs create (if PRD implies this level of granularity)
  // For simplicity, let's assume the frontend sends a full list of details as received.
  // If details can be partially updated or new ones added, logic would be more complex here.
  // Current PRD implies `details` is a full set for the received quotation.

  // Option 1: Delete existing details and add new ones (simpler if details structure can change significantly)
  // This requires fetching and deleting first, which is more ops.

  // Option 2: Try to match by productId and update, or create if no match.
  // This is safer if detail IDs are stable or not used for direct update from client.
  // For now, let's assume `data.details` can replace existing details if the client manages this.
  // The PRD for `UpdateReceivedQuotationData` has `ReceivedQuotationItemData[]` which does not include `id` for `QuotationDetail`
  // This implies we might be recreating them or the client isn't expected to know subcollection IDs.

  // Let's assume for now we overwrite details based on what's provided for simplicity of `receiveQuotation`.
  // A more robust solution would involve matching by `productId` if `quotationDetailId` is not sent.
  // Fetch existing details
    const existingDetailsSnap = await getDocs(quotationDetailsCollectionRef);
    existingDetailsSnap.docs.forEach(doc => batch.delete(doc.ref)); // Delete all old details

    for (const detail of data.details) {
        const detailRef = doc(quotationDetailsCollectionRef); // Create new doc for each received detail
        const detailData: Omit<QuotationDetail, "id"> = {
            productId: detail.productId,
            productName: detail.productName,
            requiredQuantity: detail.requiredQuantity, // Retain original required quantity
            quotedQuantity: detail.quotedQuantity,
            unitPriceQuoted: detail.unitPriceQuoted,
            conditions: detail.conditions,
            estimatedDeliveryDate: detail.estimatedDeliveryDate,
            notes: detail.notes,
        };
        batch.set(detailRef, detailData);
    }

  await batch.commit();
};

// Function to change only the status of a quotation (e.g., Awarded, Rejected)
export const updateQuotationStatus = async (id: string, newStatus: QuotationStatus, userId: string): Promise<void> => {
    const quotationRef = doc(db, "cotizaciones", id);
    const quotationSnap = await getDoc(quotationRef);
    if (!quotationSnap.exists()) {
        throw new Error("Quotation not found.");
    }
    // Add business logic here, e.g., cannot change status if it's already 'Completed' or 'Canceled' by PO.
    // Or if changing to 'Awarded', check if other quotations for the same requisition need to be 'Lost'.

    await updateDoc(quotationRef, {
        status: newStatus,
        updatedAt: Timestamp.now(),
        // Potentially log who changed the status if different from createdBy/generatedByUserId
    });
};
