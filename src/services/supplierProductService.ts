
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
  deleteDoc
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ProveedorProducto, PriceRange } from "@/types";
import { getProductById } from "./productService"; // To validate product existence
import { getSupplierById } from "./supplierService"; // To validate supplier existence

const proveedorProductosCollection = collection(db, "proveedorProductos");

/*
Conceptual Firestore Security Rules for /proveedorProductos collection:

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

    function isAdminOrSuperAdmin() {
      if (!isAuthenticatedAndActive()) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData.role == 'admin' || userData.role == 'superadmin';
    }

    match /proveedorProductos/{supplierProductId} {
      allow read: if isAuthenticatedAndActive();
      allow create: if isAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.supplierId != null &&
                       request.resource.data.productId != null &&
                       request.resource.data.supplierSku != null &&
                       request.resource.data.priceRanges != null && request.resource.data.priceRanges.size() > 0;
      allow update: if isAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == resource.data.createdBy; // Prevent changing createdBy
      allow delete: if isAdminOrSuperAdmin(); // Allow hard delete by admin/superadmin if needed, or soft delete via isActive
    }
  }
}

Conceptual Firestore Indexes for /proveedorProductos:
- (supplierId, productId) (Composite, Unique preferred if IDs are combined for document ID)
- (supplierId, isActive, lastPriceUpdate Desc)
- (productId, isActive, lastPriceUpdate Desc)
- (supplierSku, supplierId) (If searching by supplier's SKU)
- (productId, isActive)
- (supplierId, isActive)
*/

export type CreateSupplierProductData = Omit<ProveedorProducto, "id" | "createdAt" | "updatedAt" | "isActive" | "createdBy">;
export type UpdateSupplierProductData = Partial<Omit<ProveedorProducto, "id" | "createdAt" | "createdBy" | "updatedAt" | "isActive">>;

export const checkExistingSupplierProductLink = async (supplierId: string, productId: string, excludeId?: string): Promise<boolean> => {
  const qConstraints: QueryConstraint[] = [
    where("supplierId", "==", supplierId),
    where("productId", "==", productId),
    limit(1)
  ];
  const q = query(proveedorProductosCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) return false;
  if (excludeId && querySnapshot.docs[0].id === excludeId) return false;
  return true; 
};

export const createSupplierProduct = async (data: CreateSupplierProductData, userId: string): Promise<string> => {
  const supplier = await getSupplierById(data.supplierId);
  if (!supplier || !supplier.isActive) throw new Error("Selected supplier is not valid or not active.");
  const product = await getProductById(data.productId);
  if (!product || !product.isActive) throw new Error("Selected product is not valid or not active.");
  if (await checkExistingSupplierProductLink(data.supplierId, data.productId)) {
    throw new Error(`This product is already linked to supplier "${supplier.name}". Update the existing link instead.`);
  }
  if (!data.supplierSku || data.supplierSku.trim() === "") throw new Error("Supplier SKU is required.");
  if (!data.priceRanges || data.priceRanges.length === 0) throw new Error("At least one price range must be defined.");

  const now = Timestamp.now();
  const docRef = await addDoc(proveedorProductosCollection, {
    ...data,
    notes: data.notes || "", 
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    lastPriceUpdate: now,
    isActive: true, // New links are active by default
    isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
  });
  return docRef.id;
};

export const getSupplierProductById = async (id: string): Promise<ProveedorProducto | null> => {
  if (!id) return null;
  const docRef = doc(db, "proveedorProductos", id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) return { id: docSnap.id, ...docSnap.data() } as ProveedorProducto;
  return null;
};

export const getSupplierProduct = async (supplierId: string, productId: string): Promise<ProveedorProducto | null> => {
  const q = query(proveedorProductosCollection, where("supplierId", "==", supplierId), where("productId", "==", productId), limit(1));
  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    const docSnap = querySnapshot.docs[0];
    return { id: docSnap.id, ...docSnap.data() } as ProveedorProducto;
  }
  return null;
};

export const getAllSupplierProductsBySupplier = async (supplierId: string, filterActiveOnly = true): Promise<ProveedorProducto[]> => {
  const qConstraints: QueryConstraint[] = [where("supplierId", "==", supplierId)];
  if (filterActiveOnly) qConstraints.push(where("isActive", "==", true));
  qConstraints.push(orderBy("productId")); 

  const q = query(proveedorProductosCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ProveedorProducto));
};

export const getAllSupplierProductsByProduct = async (productId: string, filterActiveAndInactive = false): Promise<ProveedorProducto[]> => {
  const qConstraints: QueryConstraint[] = [where("productId", "==", productId)];
  if (!filterActiveAndInactive) { // Default to only active, unless explicitly asking for all
    qConstraints.push(where("isActive", "==", true));
  }
  qConstraints.push(orderBy("supplierId")); 

  const q = query(proveedorProductosCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ProveedorProducto));
};

export const updateSupplierProduct = async (id: string, data: UpdateSupplierProductData): Promise<void> => {
  const docRef = doc(db, "proveedorProductos", id);
  const currentLink = await getSupplierProductById(id);
  if (!currentLink) throw new Error("Supplier-product link not found.");

  const newSupplierId = data.supplierId !== undefined ? data.supplierId : currentLink.supplierId;
  const newProductId = data.productId !== undefined ? data.productId : currentLink.productId;

  if (newSupplierId !== currentLink.supplierId || newProductId !== currentLink.productId) {
    if (await checkExistingSupplierProductLink(newSupplierId, newProductId, id)) {
      throw new Error(`A link for this product and supplier combination already exists.`);
    }
    if (data.supplierId && data.supplierId !== currentLink.supplierId) {
        const supplier = await getSupplierById(data.supplierId);
        if (!supplier || !supplier.isActive) throw new Error("New selected supplier is not valid or not active.");
    }
    if (data.productId && data.productId !== currentLink.productId) {
        const product = await getProductById(data.productId);
        if (!product || !product.isActive) throw new Error("New selected product is not valid or not active.");
    }
  }
  
  const updatePayload: Partial<ProveedorProducto> = { ...data };
  updatePayload.updatedAt = Timestamp.now();

  if (data.priceRanges !== undefined) {
    updatePayload.lastPriceUpdate = Timestamp.now();
    if (data.priceRanges.length === 0) throw new Error("At least one price range must be defined.");
  }
  if (data.supplierSku !== undefined && data.supplierSku.trim() === "") throw new Error("Supplier SKU cannot be empty.");

  await updateDoc(docRef, updatePayload);
};

export const toggleSupplierProductActiveStatus = async (id: string, currentIsActive: boolean): Promise<void> => {
  const docRef = doc(db, "proveedorProductos", id);
  await updateDoc(docRef, {
    isActive: !currentIsActive,
    updatedAt: Timestamp.now(),
  });
};

export const deleteSupplierProduct = async (id: string): Promise<void> => {
  const docRef = doc(db, "proveedorProductos", id);
  await deleteDoc(docRef);
};

export const getSupplierProductPricing = async (supplierId: string, productId: string): Promise<PriceRange[] | null> => {
  const supplierProduct = await getSupplierProduct(supplierId, productId);
  if (supplierProduct && supplierProduct.isActive && supplierProduct.isAvailable) return supplierProduct.priceRanges;
  return null;
};
    
