
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
import { updatePurchaseOrderStatus } from "./purchaseOrderService"; // Added for direct status update

export interface CreateReceiptServiceData {
  purchaseOrderId: string;
  receiptDate: Timestamp;
  receivingUserId: string;
  targetWarehouseId: string;
  notes: string;
  itemsToReceive: Array<{
    productId: string;
    productName: string; 
    quantityReceived: number;
    itemStatus: ReceiptItemStatus;
    itemNotes: string; 
    poDetailId: string; 
    currentPOReceivedQuantity: number; 
    poOrderedQuantity: number; 
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

  for (const item of data.itemsToReceive) {
    if (item.quantityReceived <= 0 && item.itemStatus !== "Missing") continue; 
    // If status is "Missing", quantityReceived should be 0, but we still record it as a discrepancy.

    const product = await getProductById(item.productId); 
    if (!product || !product.isActive) {
      throw new Error(`Product ${item.productName} (ID: ${item.productId}) is not valid or active for receipt.`);
    }

    const receivedItemRef = doc(collection(receiptRef, "receivedItems"));
    const receivedItemData: Omit<ReceivedItem, "id"> = {
      productId: item.productId,
      productName: product.name, 
      quantityReceived: item.quantityReceived,
      itemStatus: item.itemStatus,
      notes: item.itemNotes,
    };
    batch.set(receivedItemRef, receivedItemData);

    // Only update stock for "Ok" or "Damaged" items that have quantity > 0
    // "Missing" items don't increase stock. "Damaged" items might (depending on business rules, for now they do).
    if (item.quantityReceived > 0 && (item.itemStatus === "Ok" || item.itemStatus === "Damaged")) {
      const { quantityBefore, quantityAfter } = await updateStockItem(
        item.productId,
        data.targetWarehouseId,
        item.quantityReceived, 
        data.receivingUserId,
        batch 
      );

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
          notes: `Item: ${product.name}. Qty: ${item.quantityReceived}. Status: ${item.itemStatus}. ${item.itemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId,
          supplierId: purchaseOrder.supplierId,
        },
        batch 
      );
    }
    
    const poDetailRef = doc(db, `purchaseOrders/${data.purchaseOrderId}/details/${item.poDetailId}`);
    const newTotalReceivedForPOItem = item.currentPOReceivedQuantity + item.quantityReceived;
    batch.update(poDetailRef, { receivedQuantity: newTotalReceivedForPOItem });
  }
  
  batch.update(poRef, { updatedAt: now });

  await batch.commit();
  return receiptRef.id;
};

async function getPODetailsForStatusCheck(poId: string): Promise<PurchaseOrderDetail[]> {
    const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
    const snapshot = await getDocs(query(detailsCollectionRef)); // No specific order needed for this check
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PurchaseOrderDetail));
}

export async function updatePOStatusAfterReceipt(purchaseOrderId: string, userId: string) {
    const poRef = doc(db, "purchaseOrders", purchaseOrderId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
        console.error(`PO ${purchaseOrderId} not found during status update after receipt.`);
        return;
    }

    const purchaseOrder = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;
    const details = await getPODetailsForStatusCheck(purchaseOrderId);

    if (details.length === 0 && purchaseOrder.details && purchaseOrder.details.length > 0) {
        console.warn(`PO ${purchaseOrderId} has no details in subcollection for status check, but parent doc has details. Status might be incorrect.`);
        // Fallback to PartiallyDelivered if details subcollection is unexpectedly empty
        // but parent document indicates there should be details.
        if (purchaseOrder.status !== "PartiallyDelivered") {
           await updatePurchaseOrderStatus(purchaseOrderId, "PartiallyDelivered", userId);
        }
        return;
    }
    if (details.length === 0 && (!purchaseOrder.details || purchaseOrder.details.length === 0)) {
        // PO has no line items at all. Mark as completed.
        if (purchaseOrder.status !== "Completed") {
            await updatePurchaseOrderStatus(purchaseOrderId, "Completed", userId);
        }
        return;
    }

    let allItemsFullyReceived = true;
    let anyItemReceived = false;

    for (const detail of details) {
        if (detail.receivedQuantity > 0) {
            anyItemReceived = true;
        }
        if (detail.receivedQuantity < detail.orderedQuantity) {
            allItemsFullyReceived = false;
        }
    }

    let newStatus: PurchaseOrderStatus;

    if (allItemsFullyReceived) {
        newStatus = "Completed";
    } else if (anyItemReceived) { // If any item has been received but not all, it's partially delivered
        newStatus = "PartiallyDelivered";
    } else { // No items received yet, or only 'Missing' statuses were recorded without quantity
        // Check if the original status implies it was already partially handled
        // Or if it's still just confirmed by supplier waiting for first receipt
        newStatus = purchaseOrder.status; // Keep current status if no actual receipt quantities changed things
        if (newStatus !== "PartiallyDelivered" && newStatus !== "ConfirmedBySupplier" && newStatus !== "Completed") {
             // If it's e.g. "Pending" or "SentToSupplier", it shouldn't change just because a 'Missing' receipt was recorded
             // However, if it was 'ConfirmedBySupplier' and the receipt results in 0 quantity with 'Missing' items,
             // it should become 'PartiallyDelivered'.
             // This part needs care. The `createReceipt` only processes if quantityReceived > 0 OR itemStatus is Missing.
             // If only 'Missing' items were recorded, quantityReceived sums to 0.
             // For now, let's assume if `anyItemReceived` is false, but a receipt was recorded, it implies discrepancies.
             if (data.itemsToReceive.some(item => item.itemStatus === 'Missing' || item.itemStatus === 'Damaged' && item.quantityReceived === 0)) {
                 newStatus = "PartiallyDelivered";
             }
        }
    }
    
    if (newStatus !== purchaseOrder.status) {
        await updatePurchaseOrderStatus(purchaseOrderId, newStatus, userId);
    } else if (purchaseOrder.status === "PartiallyDelivered" && allItemsFullyReceived) {
        // Edge case: was PartiallyDelivered, now all items are received.
        await updatePurchaseOrderStatus(purchaseOrderId, "Completed", userId);
    } else {
        // If status doesn't change, still update the `updatedAt` timestamp directly.
        await updateDoc(poRef, { updatedAt: Timestamp.now() });
    }
}

    