
import {
  collection, doc, getDoc, setDoc, updateDoc, Timestamp, writeBatch, type WriteBatch, addDoc, runTransaction
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StockItem, StockMovement, StockMovementType } from "@/types";

// --- StockItem Service Functions ---
const stockItemsCollection = collection(db, "stockItems");

export const getStockItemRef = (productId: string, warehouseId: string): any => {
  const stockItemId = `${productId}_${warehouseId}`;
  return doc(stockItemsCollection, stockItemId);
};

/**
 * Updates a stock item's quantity. Can be part of a batch or transaction.
 * If not part of a batch/transaction, it will perform a direct Firestore operation (less safe for multi-step processes).
 */
export const updateStockItem = async (
  productId: string,
  warehouseId: string,
  quantityChange: number, // can be positive (inbound) or negative (outbound)
  userId: string,
  batchOrTransaction?: WriteBatch | any // Firebase Transaction or WriteBatch
): Promise<{ quantityBefore: number; quantityAfter: number }> => {
  const stockItemRef = getStockItemRef(productId, warehouseId);
  const now = Timestamp.now();

  let quantityBefore = 0;
  let quantityAfter = 0;

  // Helper function to perform the read and write, adaptable for transactions or direct operations
  const performUpdate = async (executor: any) => {
    let stockItemSnap;
    if (typeof executor.get === 'function') { // Check if it's a transaction-like object
      stockItemSnap = await executor.get(stockItemRef);
    } else { // Assume it's the db for direct getDoc
      stockItemSnap = await getDoc(stockItemRef);
    }

    if (stockItemSnap.exists()) {
      quantityBefore = stockItemSnap.data()?.quantity || 0;
      quantityAfter = quantityBefore + quantityChange;
      if (quantityAfter < 0) {
        throw new Error(`Stock quantity for product ${productId} in warehouse ${warehouseId} cannot go below zero. Current: ${quantityBefore}, Change: ${quantityChange}`);
      }
      const updateData = {
        quantity: quantityAfter,
        lastStockUpdate: now,
        updatedBy: userId,
      };
      if (typeof executor.update === 'function') { // Transaction/Batch update
        executor.update(stockItemRef, updateData);
      } else { // Direct update
        await updateDoc(stockItemRef, updateData);
      }
    } else {
      // Document doesn't exist, create it
      if (quantityChange < 0) {
        throw new Error(`Cannot create stock item for product ${productId} in warehouse ${warehouseId} with negative initial quantity: ${quantityChange}.`);
      }
      quantityBefore = 0;
      quantityAfter = quantityChange;
      const newStockItemData: StockItem = {
        productId,
        warehouseId,
        quantity: quantityAfter,
        lastStockUpdate: now,
        updatedBy: userId,
      };
      if (typeof executor.set === 'function') { // Transaction/Batch set
        executor.set(stockItemRef, newStockItemData);
      } else { // Direct set
        await setDoc(stockItemRef, newStockItemData);
      }
    }
  };

  if (batchOrTransaction) {
    await performUpdate(batchOrTransaction);
  } else {
    // For standalone direct operations, wrap in a Firestore transaction for atomicity
    await runTransaction(db, async (transaction) => {
      await performUpdate(transaction);
    });
  }
  return { quantityBefore, quantityAfter };
};


// --- StockMovement Service Functions ---
const stockMovementsCollection = collection(db, "stockMovements");

export interface RecordStockMovementData {
    productId: string;
    productName: string; // Denormalized
    warehouseId: string;
    warehouseName: string; // Denormalized
    type: StockMovementType;
    quantityChanged: number;
    quantityBefore: number; // This will now be passed in
    quantityAfter: number;  // This will now be passed in
    movementDate: Timestamp;
    userId: string;
    userName: string; // Denormalized
    reason: string;
    notes?: string;
    relatedDocumentId?: string;
    supplierId?: string;
}

export const recordStockMovement = async (
  data: RecordStockMovementData,
  batch?: WriteBatch // Optional batch
): Promise<string> => {

  if (data.quantityChanged === 0) {
    console.warn(`Attempted to record a stock movement with zero quantity change for product ${data.productId}. Skipping.`);
    return ""; // Or throw error, depending on desired behavior
  }

  const movementData: Omit<StockMovement, "id"> = {
    productId: data.productId,
    warehouseId: data.warehouseId,
    type: data.type,
    quantityChanged: data.quantityChanged,
    quantityBefore: data.quantityBefore,
    quantityAfter: data.quantityAfter,
    movementDate: data.movementDate,
    userId: data.userId,
    reason: data.reason,
    notes: data.notes || "",
    relatedDocumentId: data.relatedDocumentId,
    supplierId: data.type === 'INBOUND_PO' ? data.supplierId : undefined,
    // Denormalized fields for easier display in movement logs
    productName: data.productName,
    warehouseName: data.warehouseName,
    userName: data.userName,
  };

  const movementRef = doc(stockMovementsCollection); // Generate ref for ID even in batch
  if (batch) {
    batch.set(movementRef, movementData);
    return movementRef.id; 
  } else {
    const docRef = await addDoc(stockMovementsCollection, movementData);
    return docRef.id;
  }
};


    