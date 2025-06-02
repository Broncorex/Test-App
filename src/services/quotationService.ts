
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
import { getUserById } from "./userService";
import { getProductById } from "./productService";

const quotationsCollection = collection(db, "cotizaciones"); 

export interface CreateQuotationRequestData {
  requisitionId: string;
  supplierId: string;
  responseDeadline: Timestamp;
  notes: string;
  productDetailsToRequest: Array<{ 
    productId: string;
    productName: string;
    requiredQuantity: number;
  }>;
}

export interface ReceivedQuotationItemData {
  productId: string;
  productName: string; 
  requiredQuantity: number; 
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
  notes: string; 
  details: ReceivedQuotationItemData[];
}

export interface QuotationFilters {
  requisitionId?: string;
  supplierId?: string;
  status?: QuotationStatus;
  dateFrom?: Timestamp;
  dateTo?: Timestamp;
}

const calculateTotalQuotation = (
  productsSubtotal: number,
  additionalCosts?: QuotationAdditionalCost[]
): number => {
  let total = productsSubtotal;
  if (additionalCosts) {
    total += additionalCosts.reduce((sum, cost) => sum + Number(cost.amount), 0);
  }
  return total;
};


export const createQuotation = async (data: CreateQuotationRequestData, userId: string): Promise<string> => {
  const batch = writeBatch(db);
  const now = Timestamp.now();

  const requisition = await getRequisitionById(data.requisitionId);
  if (!requisition) { 
    throw new Error("Requisition not found or is invalid.");
  }
  if (["PO in Progress", "Completed", "Canceled"].includes(requisition.status)) {
    throw new Error(`Cannot request quotations for a requisition with status: ${requisition.status}.`);
  }

  const supplier = await getSupplierById(data.supplierId);
  if (!supplier || !supplier.isActive) {
    throw new Error("Supplier not found or is not active.");
  }

  const generatingUser = await getUserById(userId);
  if (!generatingUser) {
    throw new Error("Generating user not found.");
  }

  if (!data.productDetailsToRequest || data.productDetailsToRequest.length === 0) {
    throw new Error("At least one product must be selected for the quotation request.");
  }

  const quotationRef = doc(quotationsCollection);
  const quotationData: Omit<Quotation, "id" | "quotationDetails" | "supplierName" | "generatedByUserName"> = {
    requisitionId: data.requisitionId,
    supplierId: data.supplierId,
    requestDate: now,
    responseDeadline: data.responseDeadline,
    status: "Sent",
    notes: data.notes,
    generatedByUserId: userId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    // productsSubtotal, totalQuotation, etc., will be set upon reception
  };
  batch.set(quotationRef, quotationData);

  const quotationDetailsCollectionRef = collection(quotationRef, "quotationDetails");
  for (const requestedProduct of data.productDetailsToRequest) {
    const productInfo = await getProductById(requestedProduct.productId);
    if(!productInfo || !productInfo.isActive){
        console.warn(`Product ID ${requestedProduct.productId} for quotation is not found or inactive. Skipping for quotation detail.`);
        continue;
    }

    const detailRef = doc(quotationDetailsCollectionRef);
    // Initial detail only includes requested info. Quoted values come later.
    const detailData: Omit<QuotationDetail, "id" | "quotedQuantity" | "unitPriceQuoted" | "conditions" | "estimatedDeliveryDate" | "notes"> & 
                      Partial<Pick<QuotationDetail, "quotedQuantity" | "unitPriceQuoted" | "conditions" | "estimatedDeliveryDate" | "notes">> = {
      productId: requestedProduct.productId,
      productName: requestedProduct.productName, 
      requiredQuantity: requestedProduct.requiredQuantity,
      // these are set when supplier responds
      // quotedQuantity: 0, 
      // unitPriceQuoted: 0,
      // conditions: "", 
      // estimatedDeliveryDate: data.responseDeadline, 
      // notes: "", 
    };
    batch.set(detailRef, detailData);
  }

  await batch.commit();

  // Update requisition status if it was "Pending Quotation"
  if (requisition.status === "Pending Quotation") {
    const requisitionDocRef = doc(db, "requisitions", data.requisitionId);
    // Using updateDoc directly as it's a single update after batch.
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
    // Ensure all fields have defaults if not present (especially for newly created details)
    quotedQuantity: docSnap.data().quotedQuantity ?? 0,
    unitPriceQuoted: docSnap.data().unitPriceQuoted ?? 0,
    conditions: docSnap.data().conditions ?? "",
    estimatedDeliveryDate: docSnap.data().estimatedDeliveryDate ?? Timestamp.now(), // Or a more sensible default like responseDeadline
    notes: docSnap.data().notes ?? "",
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
  if (filters.dateFrom) {
    qConstraints.push(where("requestDate", ">=", filters.dateFrom));
  }
  if (filters.dateTo) {
    qConstraints.push(where("requestDate", "<=", filters.dateTo));
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
    return {
      id: docSnap.id,
      ...data,
      supplierName,
      generatedByUserName,
      // quotationDetails are not typically fetched in list view for performance.
      // They are fetched in getQuotationById.
    } as Quotation;
  });

  return Promise.all(quotationsPromises);
};


export const updateQuotation = async (id: string, data: Partial<Omit<Quotation, "id" | "createdBy" | "createdAt" | "quotationDetails">>): Promise<void> => {
  const quotationRef = doc(db, "cotizaciones", id);
  // Remove fields that shouldn't be directly updatable this way
  const { createdBy, createdAt, quotationDetails, supplierName, generatedByUserName, ...updateData } = data as any;

  if (updateData.productsSubtotal !== undefined && updateData.additionalCosts !== undefined) {
    updateData.totalQuotation = calculateTotalQuotation(updateData.productsSubtotal, updateData.additionalCosts);
  } else if (updateData.productsSubtotal !== undefined) {
     const currentQuotation = await getQuotationById(id); // Fetch full quote to get existing additional costs
     if (currentQuotation) {
        updateData.totalQuotation = calculateTotalQuotation(updateData.productsSubtotal, currentQuotation.additionalCosts);
     }
  } else if (updateData.additionalCosts !== undefined) {
    const currentQuotation = await getQuotationById(id); // Fetch full quote for productsSubtotal
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
  
  const calculatedSubtotal = data.details.reduce((sum, item) => sum + (Number(item.quotedQuantity) * Number(item.unitPriceQuoted)), 0);
  if (Math.abs(calculatedSubtotal - data.productsSubtotal) > 0.001) { 
    console.warn(`Provided productsSubtotal ${data.productsSubtotal} does not match calculated ${calculatedSubtotal}. Using calculated value.`);
  }

  const totalQuotation = calculateTotalQuotation(calculatedSubtotal, data.additionalCosts);

  const mainUpdateData: Partial<Quotation> = {
    status: "Received",
    receivedDate: data.receivedDate,
    productsSubtotal: calculatedSubtotal,
    additionalCosts: data.additionalCosts || [],
    totalQuotation: totalQuotation,
    shippingConditions: data.shippingConditions,
    notes: data.notes, 
    updatedAt: Timestamp.now(),
  };
  batch.update(quotationRef, mainUpdateData);

  const quotationDetailsCollectionRef = collection(quotationRef, "quotationDetails");
  
  // Fetch existing details to update them or create new ones if they don't match
  // This is safer than deleting all and re-adding if IDs are important or if only some details change.
  // However, if the structure from `data.details` is always the full set, deleting and re-adding is simpler.
  // For simplicity and based on current UI flow (dialog likely re-populates all details):
  const existingDetailsSnap = await getDocs(quotationDetailsCollectionRef);
  existingDetailsSnap.docs.forEach(doc => batch.delete(doc.ref)); 

  for (const detail of data.details) {
      // For `receiveQuotation`, we assume new detail IDs are generated.
      // If we needed to preserve existing detail IDs, we would query for existing ones by productId.
      const detailRef = doc(quotationDetailsCollectionRef); 
      const detailData: Omit<QuotationDetail, "id"> = {
          productId: detail.productId,
          productName: detail.productName,
          requiredQuantity: detail.requiredQuantity,
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

export const updateQuotationStatus = async (id: string, newStatus: QuotationStatus, userId?: string): Promise<void> => {
    const quotationRef = doc(db, "cotizaciones", id);
    const quotationSnap = await getDoc(quotationRef);
    if (!quotationSnap.exists()) {
        throw new Error("Quotation not found.");
    }
    // Add more complex status transition logic here if needed.
    // For example, ensure it's not moving from "Awarded" back to "Sent" without proper checks.
    await updateDoc(quotationRef, {
        status: newStatus,
        updatedAt: Timestamp.now(),
        // ...(userId && { updatedBy: userId }) // Optionally track who updated the status
    });
};

