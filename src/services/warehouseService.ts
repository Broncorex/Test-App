
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  writeBatch,
  orderBy,
  limit
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Warehouse } from "@/types";

const warehousesCollection = collection(db, "warehouses");

export type CreateWarehouseData = Omit<Warehouse, "id" | "createdAt" | "updatedAt" | "isActive">;
export type UpdateWarehouseData = Partial<Omit<Warehouse, "id" | "createdAt" | "createdBy" | "updatedAt">>;


export const addWarehouse = async (data: CreateWarehouseData, userId: string): Promise<string> => {
  const now = Timestamp.now();
  // Ensure only one default warehouse
  if (data.isDefault) {
    const q = query(warehousesCollection, where("isDefault", "==", true), limit(1));
    const querySnapshot = await getDocs(q);
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnap) => {
      batch.update(doc(db, "warehouses", docSnap.id), { isDefault: false });
    });
    await batch.commit();
  }

  const docRef = await addDoc(warehousesCollection, {
    ...data,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  });
  return docRef.id;
};

export const getWarehouses = async (includeInactive = false): Promise<Warehouse[]> => {
  let q = query(warehousesCollection, orderBy("name"));
  if (!includeInactive) {
    q = query(q, where("isActive", "==", true));
  }
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Warehouse));
};

export const getActiveWarehouses = async (): Promise<Warehouse[]> => {
  const q = query(warehousesCollection, where("isActive", "==", true), orderBy("name"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Warehouse));
};


export const getWarehouseById = async (id: string): Promise<Warehouse | null> => {
  const docRef = doc(db, "warehouses", id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Warehouse;
  }
  return null;
};

export const updateWarehouse = async (id: string, data: UpdateWarehouseData): Promise<void> => {
  // Ensure only one default warehouse if isDefault is being set to true
  if (data.isDefault === true) {
    const q = query(warehousesCollection, where("isDefault", "==", true), where("id", "!=", id), limit(1)); // Exclude current doc
    const querySnapshot = await getDocs(q);
    const batch = writeBatch(db);
    querySnapshot.forEach((docSnap) => {
        if (docSnap.id !== id) { // double check, though query should handle it
             batch.update(doc(db, "warehouses", docSnap.id), { isDefault: false });
        }
    });
    await batch.commit();
  } else if (data.isDefault === false) {
    // Prevent unsetting the only default warehouse
    const currentDoc = await getWarehouseById(id);
    if (currentDoc?.isDefault) {
        const q = query(warehousesCollection, where("isDefault", "==", true), limit(2));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.docs.length <= 1) { // If this is the only default, or becomes the only default
            throw new Error("Cannot unset the only default warehouse. Set another warehouse as default first.");
        }
    }
  }


  const docRef = doc(db, "warehouses", id);
  await updateDoc(docRef, {
    ...data,
    updatedAt: Timestamp.now(),
  });
};


export const toggleWarehouseActiveStatus = async (id: string, currentIsActive: boolean): Promise<void> => {
  const docRef = doc(db, "warehouses", id);
  // If deactivating, ensure it's not the default warehouse
  if (currentIsActive) { // Trying to deactivate
    const warehouse = await getWarehouseById(id);
    if (warehouse?.isDefault) {
      throw new Error("Cannot deactivate the default warehouse. Set another warehouse as default first.");
    }
  }
  await updateDoc(docRef, {
    isActive: !currentIsActive,
    updatedAt: Timestamp.now(),
  });
};

export const isWarehouseNameUnique = async (name: string, excludeId?: string): Promise<boolean> => {
  let q = query(warehousesCollection, where("name", "==", name), limit(1));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return true;
  }
  if (excludeId && querySnapshot.docs[0].id === excludeId) {
    return true;
  }
  return false;
};

export const setDefaultWarehouse = async (newDefaultId: string): Promise<void> => {
  const batch = writeBatch(db);

  // Unset current default warehouse(s)
  const currentDefaultQuery = query(warehousesCollection, where("isDefault", "==", true));
  const currentDefaultSnapshot = await getDocs(currentDefaultQuery);
  currentDefaultSnapshot.forEach(docSnap => {
    if (docSnap.id !== newDefaultId) {
      batch.update(doc(db, "warehouses", docSnap.id), { isDefault: false, updatedAt: Timestamp.now() });
    }
  });

  // Set new default warehouse
  const newDefaultRef = doc(db, "warehouses", newDefaultId);
  batch.update(newDefaultRef, { isDefault: true, isActive: true, updatedAt: Timestamp.now() }); // Ensure default is active

  await batch.commit();
};
