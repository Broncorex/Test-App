
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
  collectionGroup
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Requisition, RequiredProduct, RequisitionStatus } from "@/types";
import { getUserById } from "./userService"; // Assuming userService.ts exists and has getUserById

const requisitionsCollection = collection(db, "requisitions");

/*
Conceptual Firestore Security Rules for /requisitions and subcollections:

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

    function isOwner(docData) {
      return request.auth.uid == docData.requestingUserId || request.auth.uid == docData.createdBy;
    }

    function isAdminOrSuperAdmin() {
      if (!isAuthenticatedAndActive()) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData.role == 'admin' || userData.role == 'superadmin';
    }

    match /requisitions/{requisitionId} {
      allow read: if isAuthenticatedAndActive() && (isAdminOrSuperAdmin() || isOwner(resource.data));
      allow create: if isAuthenticatedAndActive() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.requestingUserId == request.auth.uid && // User creates for themselves
                       request.resource.data.status == "Pending Quotation"; // Initial status
      allow update: if isAuthenticatedAndActive() && isAdminOrSuperAdmin(); // Admins can update status, notes etc.
                     // Employees might be able to update notes or cancel if status allows (more granular rules needed)

      match /requiredProducts/{requiredProductId} {
        allow read: if isAuthenticatedAndActive() && (isAdminOrSuperAdmin() || isOwner(get(/databases/$(database)/documents/requisitions/$(requisitionId)).data));
        allow create: if isAuthenticatedAndActive() &&
                         request.resource.data.productId != null && // Ensure required fields
                         request.resource.data.requiredQuantity > 0 &&
                         // Check if the user creating the subcollection item is the one who created the parent requisition OR an admin
                         (request.auth.uid == get(/databases/$(database)/documents/requisitions/$(requisitionId)).data.createdBy || isAdminOrSuperAdmin());
        allow update: if isAuthenticatedAndActive() && isAdminOrSuperAdmin(); // Or more granular based on status
        allow delete: if isAuthenticatedAndActive() && isAdminOrSuperAdmin(); // Or more granular based on status
      }
    }
  }
}
*/


export interface RequisitionProductData {
  productId: string;
  productName: string; // Denormalized for convenience, especially if products can be deactivated
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
  // Add other fields as needed for updates
}

export interface RequisitionFilters {
  status?: RequisitionStatus;
  requestingUserId?: string; // For admins to filter by user
  // Add date range filters, etc.
}

export const createRequisition = async (data: CreateRequisitionData, userId: string, userName: string): Promise<string> => {
  const now = Timestamp.now();
  const batch = writeBatch(db);

  const requisitionRef = doc(requisitionsCollection); // Auto-generate ID for the main requisition

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
    const requiredProductRef = doc(collection(requisitionRef, "requiredProducts")); // Auto-generate ID
    const requiredProductEntry: Omit<RequiredProduct, "id"> = {
      ...productData,
      purchasedQuantity: 0, // Default
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

  // Fetch user data for denormalization if not already present (or for fresh data)
  if (requisitionData.requestingUserId) {
    const user = await getUserById(requisitionData.requestingUserId);
    requisitionData.requestingUserName = user?.displayName || requisitionData.requestingUserId;
  }


  const requiredProductsCollection = collection(requisitionRef, "requiredProducts");
  const requiredProductsSnap = await getDocs(query(requiredProductsCollection, orderBy("productName")));
  
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
  } else if (filters.requestingUserId) { // Admin/Superadmin can filter by specific user
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

// Example function to get all products for a requisition (already part of getRequisitionById)
export const getRequiredProductsForRequisition = async (requisitionId: string): Promise<RequiredProduct[]> => {
    const requiredProductsCollectionRef = collection(db, `requisitions/${requisitionId}/requiredProducts`);
    const q = query(requiredProductsCollectionRef, orderBy("productName"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RequiredProduct));
};
