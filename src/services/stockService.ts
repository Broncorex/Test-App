
import {
  collection, doc, getDoc, setDoc, updateDoc, Timestamp, writeBatch, type WriteBatch, addDoc, runTransaction
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StockItem, StockMovement, StockMovementType, ReceiptItemStatus } from "@/types";

// --- StockItem Service Functions ---
const stockItemsCollection = collection(db, "stockItems");

export const getStockItemRef = (productId: string, warehouseId: string): any => {
  const stockItemId = `${productId}_${warehouseId}`;
  return doc(stockItemsCollection, stockItemId);
};

/**
 * Updates a stock item's quantity for usable or damaged stock.
 * Can be part of a batch or transaction.
 */
export const updateStockItem = async (
  productId: string,
  warehouseId: string,
  quantityChange: number, // Must be positive for this function logic
  itemStatus: "Ok" | "Damaged", // Determines which field to update
  userId: string,
  batchOrTransaction?: WriteBatch | any
): Promise<{ quantityBefore: number; quantityAfter: number }> => {
  if (quantityChange <= 0 && itemStatus !== "Damaged") { // Allow zero change for damaged if we decide to initialize the field
      // For 'Ok' status, a zero or negative change doesn't make sense in an "add stock" context.
      // This function is primarily for INCREASING stock counts. Decreases are typically handled by outbound movements.
      // If this function needs to handle decreases, the logic for quantityAfter < 0 check would need to be more nuanced.
      console.warn(`updateStockItem called with non-positive quantityChange (${quantityChange}) for status '${itemStatus}'. No stock updated.`);
      // To be safe, return 0s, or fetch current quantity if strict audit is needed for "no change"
      const stockItemRefForRead = getStockItemRef(productId, warehouseId);
      const currentSnap = batchOrTransaction && typeof batchOrTransaction.get === 'function' ? await batchOrTransaction.get(stockItemRefForRead) : await getDoc(stockItemRefForRead);
      const currentQty = itemStatus === "Ok" ? (currentSnap.data()?.quantity || 0) : (currentSnap.data()?.damagedQuantity || 0);
      return { quantityBefore: currentQty, quantityAfter: currentQty };
  }

  const stockItemRef = getStockItemRef(productId, warehouseId);
  const now = Timestamp.now();

  let quantityBefore = 0;
  let quantityAfter = 0;
  const fieldToUpdate = itemStatus === "Ok" ? "quantity" : "damagedQuantity";

  const performUpdate = async (executor: any) => {
    let stockItemSnap;
    if (typeof executor.get === 'function') {
      stockItemSnap = await executor.get(stockItemRef);
    } else {
      stockItemSnap = await getDoc(stockItemRef);
    }

    const currentData = stockItemSnap.data() || {};
    quantityBefore = currentData[fieldToUpdate] || 0;
    quantityAfter = quantityBefore + quantityChange;

    // For 'Ok' stock, prevent going below zero if quantityChange was negative (though this func is for inbound)
    if (itemStatus === "Ok" && quantityAfter < 0) {
      throw new Error(`Usable stock quantity for product ${productId} in warehouse ${warehouseId} cannot go below zero. Current: ${quantityBefore}, Change: ${quantityChange}`);
    }
    // For 'Damaged' stock, also prevent going below zero if quantityChange was negative (unlikely for typical inbound damaged flow)
    if (itemStatus === "Damaged" && quantityAfter < 0) {
        throw new Error(`Damaged stock quantity for product ${productId} in warehouse ${warehouseId} cannot go below zero. Current: ${quantityBefore}, Change: ${quantityChange}`);
    }


    const updateData: Partial<StockItem> = {
      [fieldToUpdate]: quantityAfter,
      lastStockUpdate: now,
      updatedBy: userId,
    };

    // Ensure other stock field is preserved or initialized
    if (itemStatus === "Ok") {
        updateData.damagedQuantity = currentData.damagedQuantity || 0;
         if (!stockItemSnap.exists()) updateData.quantity = quantityAfter; // Ensure this is set if new
    } else { // itemStatus === "Damaged"
        updateData.quantity = currentData.quantity || 0;
        if (!stockItemSnap.exists()) updateData.damagedQuantity = quantityAfter; // Ensure this is set if new
    }
    
    // If the document doesn't exist, it's an initial stock entry (or first time damaged).
    if (!stockItemSnap.exists()) {
      const newStockItemData: StockItem = {
        productId,
        warehouseId,
        quantity: itemStatus === "Ok" ? quantityAfter : 0,
        damagedQuantity: itemStatus === "Damaged" ? quantityAfter : 0,
        lastStockUpdate: now,
        updatedBy: userId,
      };
      if (typeof executor.set === 'function') {
        executor.set(stockItemRef, newStockItemData);
      } else {
        await setDoc(stockItemRef, newStockItemData);
      }
    } else {
      // Document exists, update it
      if (typeof executor.update === 'function') {
        executor.update(stockItemRef, updateData);
      } else {
        await updateDoc(stockItemRef, updateData);
      }
    }
  };

  if (batchOrTransaction) {
    await performUpdate(batchOrTransaction);
  } else {
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
    productName: string;
    warehouseId: string;
    warehouseName: string;
    type: StockMovementType;
    quantityChanged: number;
    quantityBefore: number;
    quantityAfter: number;
    movementDate: Timestamp;
    userId: string;
    userName: string;
    reason: string;
    notes?: string;
    relatedDocumentId?: string;
    supplierId?: string;
}

export const recordStockMovement = async (
  data: RecordStockMovementData,
  batch?: WriteBatch
): Promise<string> => {

  if (data.quantityChanged === 0 && data.type !== 'PO_MISSING') { // Allow PO_MISSING with 0 quantity change if it means "X were ordered, 0 received"
    console.warn(`Attempted to record a stock movement with zero physical quantity change for product ${data.productId} and type ${data.type}. Skipping physical stock movement record, but audit for missing might still be relevant.`);
    // If type is PO_MISSING, quantityChanged can represent the number missing, even if physical stock doesn't change.
    // If it's other types, a 0 quantity change usually means no movement.
    if (data.type !== 'PO_MISSING') return "";
  }

  const movementData: Omit<StockMovement, "id"> = {
    productId: data.productId,
    warehouseId: data.warehouseId,
    type: data.type,
    quantityChanged: data.quantityChanged, // For PO_MISSING, this is the number declared missing
    quantityBefore: data.quantityBefore, // For PO_MISSING, this will be 0
    quantityAfter: data.quantityAfter,   // For PO_MISSING, this will be 0
    movementDate: data.movementDate,
    userId: data.userId,
    reason: data.reason,
    notes: data.notes || "",
    relatedDocumentId: data.relatedDocumentId,
    supplierId: (data.type === 'INBOUND_PO' || data.type === 'INBOUND_PO_DAMAGED') ? data.supplierId : undefined,
    productName: data.productName,
    warehouseName: data.warehouseName,
    userName: data.userName,
  };

  const movementRef = doc(stockMovementsCollection);
  if (batch) {
    batch.set(movementRef, movementData);
    return movementRef.id;
  } else {
    const docRef = await addDoc(stockMovementsCollection, movementData);
    return docRef.id;
  }
};

    