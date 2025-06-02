
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
  deleteDoc,
  documentId
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Product, ProductDimension } from "@/types";
import { getCategoryById } from "./categoryService";
import { getSupplierById } from "./supplierService";

const productsCollection = collection(db, "products");

/*
Conceptual Firestore Security Rules for /products collection:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function getUserData(userId) {
      if (userId == null) { return null; }
      return get(/databases/$(database)/documents/users/$(userId)).data;
    }

    function isAuthenticatedAndActiveAdminOrSuperAdmin() {
      if (request.auth == null || request.auth.uid == null) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData != null && userData.isActive == true &&
             (userData.role == 'admin' || userData.role == 'superadmin');
    }
    
    function isAuthenticatedAndActiveEmployee() {
      if (request.auth == null || request.auth.uid == null) { return false; }
      let userData = getUserData(request.auth.uid);
      return userData != null && userData.isActive == true && userData.role == 'employee';
    }

    match /products/{productId} {
      allow read: if (isAuthenticatedAndActiveAdminOrSuperAdmin()) ||
                     (isAuthenticatedAndActiveEmployee() && resource.data.isActive == true && resource.data.isAvailableForSale == true);
      allow create: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.isActive == true &&
                       request.resource.data.name != null &&
                       request.resource.data.description != null &&
                       request.resource.data.sku != null && // SKU will be generated if not provided, but must exist on write
                       request.resource.data.costPrice == 0 && 
                       request.resource.data.basePrice != null && request.resource.data.basePrice >= 0 &&
                       request.resource.data.sellingPrice != null && 
                       request.resource.data.categoryIds != null && request.resource.data.categoryIds.size() > 0 &&
                       request.resource.data.imageUrl != null &&
                       request.resource.data.tags != null && request.resource.data.tags.size() > 0 &&
                       request.resource.data.lowStockThreshold != null && request.resource.data.lowStockThreshold >= 0 &&
                       request.resource.data.supplierId != null && 
                       request.resource.data.barcode != null &&
                       request.resource.data.weight != null && request.resource.data.weight > 0 &&
                       request.resource.data.dimensions != null &&
                       request.resource.data.dimensions.length > 0 &&
                       request.resource.data.dimensions.width > 0 &&
                       request.resource.data.dimensions.height > 0;

      allow update: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == resource.data.createdBy &&
                       request.resource.data.costPrice == resource.data.costPrice && // costPrice cannot be changed by client update
                       request.resource.data.sku == resource.data.sku; // sku cannot be changed after creation
      allow delete: if false; 
    }
  }
}

Conceptual Firestore Indexes for /products collection:
- sku (Ascending) - For unique SKU checks and direct lookups
- name (Ascending) - For sorting and searching by name
- supplierId (Ascending), name (Ascending) - For filtering by supplier and sorting
- categoryIds (Array-contains), name (Ascending) - For filtering by category and sorting
- isActive (Ascending), name (Ascending) - For general listing of active products
- isActive (Ascending), isAvailableForSale (Ascending), name (Ascending) - For employee views
- lowStockThreshold (Ascending), isActive (Ascending) - For low stock reports (though stockItems is better for this)
*/

// CreateProductData: sku is now optional as it can be auto-generated.
export type CreateProductData = Omit<Product, "id" | "createdAt" | "updatedAt" | "sellingPrice" | "isActive" | "createdBy" | "sku"> & { sku?: string };
export type UpdateProductData = Partial<Omit<Product, "id" | "createdAt" | "createdBy" | "updatedAt" | "isActive" | "sku" | "costPrice">>; 

export interface ProductFilters {
  filterActive?: boolean;
  filterAvailableForSale?: boolean;
  categoryId?: string;
  supplierId?: string;
  searchQuery?: string; 
}

export const calculateSellingPrice = (
  basePrice: number,
  discountPercentage: number = 0,
  discountAmount: number = 0
): number => {
  let priceAfterPercentageDiscount = basePrice * (1 - discountPercentage / 100);
  let finalPrice = priceAfterPercentageDiscount - discountAmount;
  return Math.max(0, finalPrice); 
};

export const isSkuUnique = async (sku: string, excludeId?: string): Promise<boolean> => {
  const q = query(productsCollection, where("sku", "==", sku.trim()), limit(1));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return true;
  }
  if (excludeId && querySnapshot.docs[0].id === excludeId) {
    return true; 
  }
  return false; 
};

const generateSkuFromName = (name: string): string => {
    const namePrefix = name.substring(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    let generatedSku = `${namePrefix}-${randomSuffix}`;
    if (namePrefix.length < 2) { // Fallback if name is too short or has no alphanumeric chars
        generatedSku = `PROD-${randomSuffix}`;
    }
    return generatedSku.substring(0, 20); // Max SKU length
}

export const createProduct = async (data: CreateProductData, userId: string): Promise<string> => {
  let finalSku = data.sku?.trim();
  const isSkuProvidedByClient = !!finalSku;

  if (!isSkuProvidedByClient) {
    finalSku = generateSkuFromName(data.name);
  }

  if (!finalSku) { // Should not happen if generation logic is sound
    throw new Error("SKU could not be determined or generated.");
  }

  if (!(await isSkuUnique(finalSku))) {
    if (!isSkuProvidedByClient) {
        // Attempt a slightly different SKU if auto-generated one fails (simple retry with timestamp)
        const timestampSuffix = Date.now().toString(36).slice(-5).toUpperCase();
        finalSku = `${data.name.substring(0,3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'P'}-${timestampSuffix}`;
        finalSku = finalSku.substring(0,20); // Ensure length
        if (!(await isSkuUnique(finalSku))) {
            throw new Error("Failed to auto-generate a unique SKU. Please try submitting again, or manually enter a unique SKU if this issue persists (feature to be added).");
        }
    } else {
        throw new Error(`Product SKU "${finalSku}" must be unique. This SKU is already in use.`);
    }
  }

  if (data.costPrice !== 0) {
    console.warn("Attempting to create product with non-zero initial costPrice. Forcing to 0.");
    data.costPrice = 0;
  }

  if (!data.supplierId) throw new Error("Primary supplier is required.");
  const supplier = await getSupplierById(data.supplierId);
  if (!supplier || !supplier.isActive) {
    throw new Error("Selected primary supplier is not valid or not active.");
  }

  if (!data.categoryIds || data.categoryIds.length === 0) {
    throw new Error("At least one category is required.");
  }
  for (const catId of data.categoryIds) {
    const category = await getCategoryById(catId);
    if (!category || !category.isActive) {
      throw new Error(`Category ID "${catId}" is not valid or not active.`);
    }
  }
  
  const now = Timestamp.now();
  const sellingPrice = calculateSellingPrice(
    data.basePrice,
    data.discountPercentage,
    data.discountAmount
  );

  const productToCreate: Omit<Product, "id"> = {
    ...data,
    sku: finalSku, // Use the generated or validated SKU
    costPrice: 0, 
    sellingPrice,
    promotionStartDate: data.promotionStartDate || null,
    promotionEndDate: data.promotionEndDate || null,
    unitOfMeasure: data.unitOfMeasure || "",
    discountPercentage: data.discountPercentage || 0,
    discountAmount: data.discountAmount || 0,
    isAvailableForSale: data.isAvailableForSale !== undefined ? data.isAvailableForSale : true,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  };

  const docRef = await addDoc(productsCollection, productToCreate);
  return docRef.id;
};

export const getProductById = async (id: string): Promise<Product | null> => {
  if (!id) return null;
  const docRef = doc(db, "products", id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Product;
  }
  return null;
};

export const getAllProducts = async (filters: ProductFilters = {}): Promise<Product[]> => {
  const { filterActive = true, filterAvailableForSale, categoryId, supplierId, searchQuery } = filters;
  
  let qConstraints: QueryConstraint[] = [];

  if (filterActive) {
    qConstraints.push(where("isActive", "==", true));
  }
  if (filterAvailableForSale !== undefined) {
    qConstraints.push(where("isAvailableForSale", "==", filterAvailableForSale));
  }
  if (categoryId) {
    qConstraints.push(where("categoryIds", "array-contains", categoryId));
  }
  if (supplierId) {
    qConstraints.push(where("supplierId", "==", supplierId));
  }
  
  qConstraints.push(orderBy("name"));

  const q = query(productsCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);
  
  let products = querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Product));

  if (searchQuery) {
    const lowerSearchQuery = searchQuery.toLowerCase();
    products = products.filter(p => 
      p.name.toLowerCase().includes(lowerSearchQuery) ||
      p.sku.toLowerCase().includes(lowerSearchQuery) ||
      p.tags.some(tag => tag.toLowerCase().includes(lowerSearchQuery))
    );
  }
  
  return products;
};

export const updateProduct = async (id: string, data: UpdateProductData): Promise<void> => {
  const productRef = doc(db, "products", id);
  const currentProductSnap = await getDoc(productRef);
  if (!currentProductSnap.exists()) {
    throw new Error("Product not found.");
  }
  const currentProduct = currentProductSnap.data() as Product;

  const { ...updatableData } = data as any; 

  const updatePayload: Partial<Product> = { ...updatableData };


  if (updatableData.supplierId && updatableData.supplierId !== currentProduct.supplierId) {
    const supplier = await getSupplierById(updatableData.supplierId);
    if (!supplier || !supplier.isActive) {
      throw new Error("Selected primary supplier is not valid or not active.");
    }
  }

  if (updatableData.categoryIds) {
    if (updatableData.categoryIds.length === 0) throw new Error("At least one category is required.");
    for (const catId of updatableData.categoryIds) {
      const category = await getCategoryById(catId);
      if (!category || !category.isActive) {
        throw new Error(`Category ID "${catId}" is not valid or not active.`);
      }
    }
  }
  
  const basePrice = updatableData.basePrice !== undefined ? updatableData.basePrice : currentProduct.basePrice;
  const discountPercentage = updatableData.discountPercentage !== undefined ? updatableData.discountPercentage : currentProduct.discountPercentage;
  const discountAmount = updatableData.discountAmount !== undefined ? updatableData.discountAmount : currentProduct.discountAmount;

  if (updatableData.basePrice !== undefined || updatableData.discountPercentage !== undefined || updatableData.discountAmount !== undefined) {
    updatePayload.sellingPrice = calculateSellingPrice(basePrice, discountPercentage, discountAmount);
  }
  
  updatePayload.updatedAt = Timestamp.now();

  await updateDoc(productRef, updatePayload);
};

export const toggleProductActiveStatus = async (id: string, currentIsActive: boolean): Promise<void> => {
  const docRef = doc(db, "products", id);
  await updateDoc(docRef, {
    isActive: !currentIsActive,
    updatedAt: Timestamp.now(),
  });
};

export const hardDeleteProduct = async (id: string): Promise<void> => {
  const product = await getProductById(id);
  if (!product) throw new Error("Product not found for hard delete.");
  const docRef = doc(db, "products", id);
  await deleteDoc(docRef);
};
