
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
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Supplier } from "@/types";

const suppliersCollection = collection(db, "suppliers");

/*
Conceptual Firestore Security Rules for /suppliers collection:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function getUserData(userId) {
      return get(/databases/$(database)/documents/users/$(userId)).data;
    }

    function isAuthenticatedAndActiveAdminOrSuperAdmin() {
      // Ensure request.auth is not null before trying to access request.auth.uid
      if (request.auth == null) {
        return false;
      }
      let userData = getUserData(request.auth.uid);
      return userData.isActive == true &&
             (userData.role == 'admin' || userData.role == 'superadmin');
    }

    match /suppliers/{supplierId} {
      allow read: if isAuthenticatedAndActiveAdminOrSuperAdmin();
      allow create: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.isActive == true &&
                       request.resource.data.name != null &&
                       request.resource.data.contactPerson != null &&
                       request.resource.data.contactEmail != null &&
                       request.resource.data.contactPhone != null &&
                       request.resource.data.address != null;
                       // notes can be empty string, so not strictly checking for null
      allow update: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       // Prevent changing createdBy
                       request.resource.data.createdBy == resource.data.createdBy;
      // No hard deletes from client, soft delete via update isActive.
      allow delete: if false; 
    }
  }
}
*/

export type CreateSupplierData = Omit<Supplier, "id" | "createdAt" | "updatedAt" | "isActive" | "createdBy">;
export type UpdateSupplierData = Partial<Omit<Supplier, "id" | "createdAt" | "createdBy" | "updatedAt" | "isActive">>;


export const isSupplierNameUnique = async (name: string, excludeId?: string): Promise<boolean> => {
  const q = query(suppliersCollection, where("name", "==", name), limit(1));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return true;
  }
  if (excludeId && querySnapshot.docs[0].id === excludeId) {
    return true;
  }
  return false;
};

export const createSupplier = async (data: CreateSupplierData, userId: string): Promise<string> => {
  if (!await isSupplierNameUnique(data.name)) {
    throw new Error("Supplier name must be unique.");
  }
  const now = Timestamp.now();
  const docRef = await addDoc(suppliersCollection, {
    ...data,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  });
  return docRef.id;
};

export const getAllSuppliers = async (filterActive = true): Promise<Supplier[]> => {
  let q = query(suppliersCollection, orderBy("name"));
  if (filterActive) {
    q = query(q, where("isActive", "==", true));
  }
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Supplier));
};

export const getSupplierById = async (id: string): Promise<Supplier | null> => {
  const docRef = doc(db, "suppliers", id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Supplier;
  }
  return null;
};

export const updateSupplier = async (id: string, data: UpdateSupplierData): Promise<void> => {
  if (data.name && !await isSupplierNameUnique(data.name, id)) {
    throw new Error("Supplier name must be unique.");
  }
  const docRef = doc(db, "suppliers", id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
};

export const toggleSupplierActiveStatus = async (id: string, currentIsActive: boolean): Promise<void> => {
  const docRef = doc(db, "suppliers", id);
  await updateDoc(docRef, {
    isActive: !currentIsActive,
    updatedAt: Timestamp.now(),
  });
};
