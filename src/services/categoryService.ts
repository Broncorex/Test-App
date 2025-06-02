
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
import type { Category } from "@/types";

const categoriesCollection = collection(db, "categories");

/*
Conceptual Firestore Security Rules for /categories collection:

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

    match /categories/{categoryId} {
      allow read: if (isAuthenticatedAndActiveAdminOrSuperAdmin()) || 
                     (isAuthenticatedAndActiveEmployee() && resource.data.isActive == true);
      allow create: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == request.auth.uid &&
                       request.resource.data.isActive == true &&
                       request.resource.data.name != null &&
                       request.resource.data.description != null &&
                       request.resource.data.sortOrder != null; 
                       // parentCategoryId can be null
      allow update: if isAuthenticatedAndActiveAdminOrSuperAdmin() &&
                       request.resource.data.createdBy == resource.data.createdBy; // Prevent changing createdBy
      allow delete: if false; // Soft delete only
    }
  }
}
*/

export type CreateCategoryData = Omit<Category, "id" | "createdAt" | "updatedAt" | "isActive" | "createdBy">;
export type UpdateCategoryData = Partial<Omit<Category, "id" | "createdAt" | "createdBy" | "updatedAt" | "isActive">>;

export const isCategoryNameUnique = async (name: string, parentCategoryId: string | null, excludeId?: string): Promise<boolean> => {
  let q = query(categoriesCollection, where("name", "==", name), where("parentCategoryId", "==", parentCategoryId || null));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    return true;
  }
  if (excludeId && querySnapshot.docs[0].id === excludeId) {
    return true;
  }
  return false;
};

export const createCategory = async (data: CreateCategoryData, userId: string): Promise<string> => {
  if (!await isCategoryNameUnique(data.name, data.parentCategoryId || null)) {
    throw new Error(`Category name "${data.name}" must be unique under its parent.`);
  }
  const now = Timestamp.now();
  const docRef = await addDoc(categoriesCollection, {
    ...data,
    parentCategoryId: data.parentCategoryId || null, // Ensure null is stored if undefined
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  });
  return docRef.id;
};

interface GetAllCategoriesOptions {
  filterActive?: boolean;
  parentCategoryId?: string | null; // null for top-level, string for specific parent, undefined for all
  orderBySortOrder?: boolean;
}

export const getAllCategories = async (options: GetAllCategoriesOptions = {}): Promise<Category[]> => {
  const { filterActive = true, parentCategoryId, orderBySortOrder = true } = options;
  
  let qConstraints = [];

  if (filterActive) {
    qConstraints.push(where("isActive", "==", true));
  }

  if (parentCategoryId !== undefined) { // Allows explicit query for top-level (null) or specific parent
    qConstraints.push(where("parentCategoryId", "==", parentCategoryId));
  }
  
  if (orderBySortOrder) {
    qConstraints.push(orderBy("sortOrder"), orderBy("name"));
  } else {
    qConstraints.push(orderBy("name"));
  }

  const q = query(categoriesCollection, ...qConstraints);
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as Category));
};


export const getCategoryById = async (id: string): Promise<Category | null> => {
  if (!id) return null;
  const docRef = doc(db, "categories", id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Category;
  }
  return null;
};

export const updateCategory = async (id: string, data: UpdateCategoryData): Promise<void> => {
  const currentCategory = await getCategoryById(id);
  if (!currentCategory) {
    throw new Error("Category not found.");
  }

  const newName = data.name !== undefined ? data.name : currentCategory.name;
  const newParentId = data.parentCategoryId !== undefined ? data.parentCategoryId : currentCategory.parentCategoryId;

  if ((data.name !== undefined && data.name !== currentCategory.name) || 
      (data.parentCategoryId !== undefined && data.parentCategoryId !== currentCategory.parentCategoryId)) {
    if (!await isCategoryNameUnique(newName, newParentId || null, id)) {
      throw new Error(`Category name "${newName}" must be unique under its parent.`);
    }
  }
  
  if (data.parentCategoryId === id) {
    throw new Error("A category cannot be its own parent.");
  }

  const docRef = doc(db, "categories", id);
  await updateDoc(docRef, {
    ...data,
    parentCategoryId: newParentId === undefined ? currentCategory.parentCategoryId : (newParentId || null),
    updatedAt: Timestamp.now(),
  });
};

export const toggleCategoryActiveStatus = async (id: string, currentIsActive: boolean): Promise<void> => {
  // Future enhancement: Check if category (or its children) are in use by products before deactivating.
  // For now, simple toggle.
  const docRef = doc(db, "categories", id);
  await updateDoc(docRef, {
    isActive: !currentIsActive,
    updatedAt: Timestamp.now(),
  });
};
