
import {
  collection, addDoc, Timestamp, writeBatch, doc, getDoc, updateDoc, query, where, getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Receipt, ReceivedItem, PurchaseOrder, PurchaseOrderDetail, StockMovementType, Warehouse, User as AppUser, ReceiptItemStatus
} from "@/types";
import { getUserById } from "./userService";
import { getWarehouseById } from "./warehouseService";
import { getProductById } from "./productService";
import { recordStockMovement, updateStockItem } from "./stockService";

export interface CreateReceiptServiceData {
  purchaseOrderId: string;
  receiptDate: Timestamp;
  receivingUserId: string;
  targetWarehouseId: string;
  notes: string;
  itemsToReceive: Array<{
    productId: string;
    productName: string; // Denormalized from Product
    quantityReceived: number;
    itemStatus: ReceiptItemStatus;
    itemNotes: string; // Renamed from notes to avoid conflict
    // For updating PO Detail
    poDetailId: string; // ID of the PurchaseOrderDetail subcollection document
    currentPOReceivedQuantity: number; // Current received quantity on PO detail
    poOrderedQuantity: number; // Original ordered quantity on PO detail
  }>;
}

export const createReceipt = async (data: CreateReceiptServiceData): Promise<string> => {
  const batch = writeBatch(db);
  const now = Timestamp.now();

  const receivingUser = await getUserById(data.receivingUserId);
  if (!receivingUser) throw new Error("Receiving user not found.");

  const targetWarehouse = await getWarehouseById(data.targetWarehouseId);
  if (!targetWarehouse || !targetWarehouse.isActive) {
    throw new Error("Target warehouse not found or is inactive.");
  }

  const poRef = doc(db, "purchaseOrders", data.purchaseOrderId);
  const poSnap = await getDoc(poRef);
  if (!poSnap.exists()) throw new Error("Purchase Order not found.");
  const purchaseOrder = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;


  // 1. Create Receipt document
  const receiptRef = doc(collection(db, "receipts"));
  const receiptData: Omit<Receipt, "id" | "receivedItems" | "receivingUserName" | "targetWarehouseName"> = {
    purchaseOrderId: data.purchaseOrderId,
    receiptDate: data.receiptDate,
    receivingUserId: data.receivingUserId,
    targetWarehouseId: data.targetWarehouseId,
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: data.receivingUserId,
  };
  batch.set(receiptRef, receiptData);

  // 2. Create ReceivedItem subcollection documents & Update Stock & PO Details
  for (const item of data.itemsToReceive) {
    if (item.quantityReceived <= 0) continue; // Skip items not actually received

    const product = await getProductById(item.productId); // Fetch for denormalization and validation
    if (!product || !product.isActive) {
      throw new Error(`Product ${item.productName} (ID: ${item.productId}) is not valid or active for receipt.`);
    }

    // Create ReceivedItem
    const receivedItemRef = doc(collection(receiptRef, "receivedItems"));
    const receivedItemData: Omit<ReceivedItem, "id"> = {
      productId: item.productId,
      productName: product.name, // Use fetched product name for consistency
      quantityReceived: item.quantityReceived,
      itemStatus: item.itemStatus,
      notes: item.itemNotes,
    };
    batch.set(receivedItemRef, receivedItemData);

    // Update StockItem
    const { quantityBefore, quantityAfter } = await updateStockItem(
      item.productId,
      data.targetWarehouseId,
      item.quantityReceived, // Positive for inbound
      data.receivingUserId,
      batch // Pass the batch
    );

    // Record Stock Movement
    await recordStockMovement({
        productId: item.productId,
        productName: product.name,
        warehouseId: data.targetWarehouseId,
        warehouseName: targetWarehouse.name,
        type: 'INBOUND_PO',
        quantityChanged: item.quantityReceived,
        quantityBefore,
        quantityAfter,
        movementDate: data.receiptDate,
        userId: data.receivingUserId,
        userName: receivingUser.displayName || data.receivingUserId,
        reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}...`,
        notes: `Item: ${product.name}. Status: ${item.itemStatus}. ${item.itemNotes || ''}`.trim(),
        relatedDocumentId: data.purchaseOrderId,
        supplierId: purchaseOrder.supplierId,
      },
      batch // Pass the batch
    );

    // Update PO Detail's receivedQuantity
    const poDetailRef = doc(db, `purchaseOrders/${data.purchaseOrderId}/details/${item.poDetailId}`);
    const newTotalReceivedForPOItem = item.currentPOReceivedQuantity + item.quantityReceived;
    batch.update(poDetailRef, { receivedQuantity: newTotalReceivedForPOItem });
  }

  // 3. Update PO Status
  // Fetch all details of the PO AGAIN but this time through the batch/transaction to get latest committed values if it were a transaction
  // For a simple batch, we must rely on data passed in or re-fetch outside batch if needed.
  // For accuracy, it's better if the calling UI component determines the final PO status
  // based on current state + this receipt, and then calls updatePurchaseOrderStatus separately.
  // However, for a simpler service, we can attempt to calculate it here.
  
  // Re-fetch PO details to calculate new status (this happens after item updates in the batch)
  // This part is tricky with a write batch, as reads don't see batch changes.
  // A transaction would be better here or the calling function should handle PO status update.
  // For now, assume the caller will re-evaluate and call updatePurchaseOrderStatus.
  // We'll just update the PO's updatedAt timestamp.
  batch.update(poRef, { updatedAt: now });


  // A more robust way to update PO status would be:
  // 1. The caller (UI) calculates what the new PO status would be AFTER this receipt.
  // 2. The caller makes a separate call to `purchaseOrderService.updatePurchaseOrderStatus`
  //    AFTER this `createReceipt` batch commit is successful.
  // This `createReceipt` function should ideally focus ONLY on creating the receipt and its related stock movements.

  await batch.commit();
  return receiptRef.id;
};

// Helper function to get all details for a PO to check its completion status
// This would be better in purchaseOrderService.ts
async function getPODetailsForStatusCheck(poId: string): Promise<PurchaseOrderDetail[]> {
    const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
    const snapshot = await getDocs(query(detailsCollectionRef));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PurchaseOrderDetail));
}

export async function updatePOStatusAfterReceipt(purchaseOrderId: string) {
    const poRef = doc(db, "purchaseOrders", purchaseOrderId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) return;

    const purchaseOrder = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;
    const details = await getPODetailsForStatusCheck(purchaseOrderId);

    let allItemsFullyReceived = true;
    let atLeastOneItemReceivedOrPartially = false;

    if (details.length === 0 && purchaseOrder.details && purchaseOrder.details.length > 0) {
        // This case implies something went wrong or details were not passed correctly.
        // For safety, assume not all received if we can't verify.
        allItemsFullyReceived = false;
        atLeastOneItemReceivedOrPartially = purchaseOrder.status === "PartiallyReceived"; // Preserve if already partial
    } else if (details.length > 0) {
        details.forEach(detail => {
            if (detail.receivedQuantity > 0) atLeastOneItemReceivedOrPartially = true;
            if (detail.receivedQuantity < detail.orderedQuantity) {
                allItemsFullyReceived = false;
            }
        });
    } else { // No details means nothing to receive, could be an error in PO creation.
        allItemsFullyReceived = false; 
    }


    let newPOStatus = purchaseOrder.status;
    const now = Timestamp.now();

    if (allItemsFullyReceived) {
        newPOStatus = "Completed";
        await updateDoc(poRef, { status: newPOStatus, completionDate: now, updatedAt: now });
    } else if (atLeastOneItemReceivedOrPartially && purchaseOrder.status !== "PartiallyReceived") {
        newPOStatus = "PartiallyReceived";
        await updateDoc(poRef, { status: newPOStatus, updatedAt: now });
    } else if (purchaseOrder.status !== newPOStatus) { // if any other change occurred
         await updateDoc(poRef, { updatedAt: now });
    }
    // if no change, PO updatedAt would have been touched by receiptService's batch.
}



    