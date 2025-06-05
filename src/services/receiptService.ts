
import {
  collection, addDoc, Timestamp, writeBatch, doc, getDoc, updateDoc, query, where, getDocs, runTransaction
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Receipt, ReceivedItem, PurchaseOrder, PurchaseOrderDetail, StockMovementType, Warehouse, User as AppUser, ReceiptItemStatus
} from "@/types";
import { getUserById } from "./userService";
import { getWarehouseById } from "./warehouseService";
import { getProductById } from "./productService";
import { recordStockMovement, updateStockItem } from "./stockService";
import { updatePurchaseOrderStatus } from "./purchaseOrderService";

export interface CreateReceiptServiceItemData {
  productId: string;
  productName: string; // Denormalized for stock movement notes
  poDetailId: string;  // ID of the PurchaseOrderDetail sub-document
  // Quantities for THIS SPECIFIC RECEIPT EVENT for this item
  qtyOkReceivedThisReceipt: number;
  qtyDamagedReceivedThisReceipt: number;
  qtyMissingReceivedThisReceipt: number; // Number of items declared missing *in this receipt*
  lineItemNotes?: string; // Overall notes for this item in this receipt
}
export interface CreateReceiptServiceData {
  purchaseOrderId: string;
  receiptDate: Timestamp;
  receivingUserId: string;
  targetWarehouseId: string;
  notes: string; // Overall receipt notes
  itemsToProcess: CreateReceiptServiceItemData[];
}

export const createReceipt = async (data: CreateReceiptServiceData): Promise<string> => {
  const now = Timestamp.now();

  const receivingUser = await getUserById(data.receivingUserId);
  if (!receivingUser) throw new Error("Receiving user not found.");

  const targetWarehouse = await getWarehouseById(data.targetWarehouseId);
  if (!targetWarehouse || !targetWarehouse.isActive) {
    throw new Error("Target warehouse not found or is inactive.");
  }

  const poRef = doc(db, "purchaseOrders", data.purchaseOrderId);
  // PO data needed for supplierId for stock movements
  const poSnapInitial = await getDoc(poRef);
  if (!poSnapInitial.exists()) throw new Error("Purchase Order not found.");
  const purchaseOrderDataForContext = poSnapInitial.data() as PurchaseOrder;


  const receiptRef = doc(collection(db, "receipts"));

  // Use a transaction for all reads and writes related to this receipt
  await runTransaction(db, async (transaction) => {
    const receiptDataForTransaction: Omit<Receipt, "id" | "receivedItems" | "receivingUserName" | "targetWarehouseName"> = {
      purchaseOrderId: data.purchaseOrderId,
      receiptDate: data.receiptDate,
      receivingUserId: data.receivingUserId,
      targetWarehouseId: data.targetWarehouseId,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
      createdBy: data.receivingUserId,
    };
    transaction.set(receiptRef, receiptDataForTransaction);

    for (const item of data.itemsToProcess) {
      const product = await getProductById(item.productId); // Get product details for notes, etc.
      if (!product || !product.isActive) {
        throw new Error(`Product ${item.productName} (ID: ${item.productId}) is not valid or active for receipt.`);
      }

      const poDetailRef = doc(db, `purchaseOrders/${data.purchaseOrderId}/details/${item.poDetailId}`);
      const poDetailSnap = await transaction.get(poDetailRef);
      if (!poDetailSnap.exists()) {
        throw new Error(`Purchase Order Detail item ${item.poDetailId} for product ${item.productName} not found.`);
      }
      const currentPODetail = poDetailSnap.data() as PurchaseOrderDetail;

      // --- Handle OK Quantity ---
      if (item.qtyOkReceivedThisReceipt > 0) {
        const { quantityBefore, quantityAfter } = await updateStockItem(
          item.productId,
          data.targetWarehouseId,
          item.qtyOkReceivedThisReceipt,
          "Ok",
          data.receivingUserId,
          transaction
        );
        await recordStockMovement({
          productId: item.productId, productName: product.name, warehouseId: data.targetWarehouseId, warehouseName: targetWarehouse.name,
          type: 'INBOUND_PO', quantityChanged: item.qtyOkReceivedThisReceipt, quantityBefore, quantityAfter,
          movementDate: data.receiptDate, userId: data.receivingUserId, userName: receivingUser.displayName || data.receivingUserId,
          reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}... (OK)`,
          notes: `PO Item: ${product.name}. Qty: ${item.qtyOkReceivedThisReceipt}. Status: Ok. ${item.lineItemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId, supplierId: purchaseOrderDataForContext.supplierId,
        }, transaction);

        const receivedItemOkRef = doc(collection(receiptRef, "receivedItems"));
        transaction.set(receivedItemOkRef, {
          productId: item.productId, productName: product.name, quantityReceived: item.qtyOkReceivedThisReceipt,
          itemStatus: "Ok", notes: item.lineItemNotes || "",
        } as Omit<ReceivedItem, "id">);
      }

      // --- Handle Damaged Quantity ---
      if (item.qtyDamagedReceivedThisReceipt > 0) {
        const { quantityBefore, quantityAfter } = await updateStockItem(
          item.productId,
          data.targetWarehouseId,
          item.qtyDamagedReceivedThisReceipt,
          "Damaged",
          data.receivingUserId,
          transaction
        );
        await recordStockMovement({
          productId: item.productId, productName: product.name, warehouseId: data.targetWarehouseId, warehouseName: targetWarehouse.name,
          type: 'INBOUND_PO_DAMAGED', quantityChanged: item.qtyDamagedReceivedThisReceipt, quantityBefore, quantityAfter,
          movementDate: data.receiptDate, userId: data.receivingUserId, userName: receivingUser.displayName || data.receivingUserId,
          reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}... (Damaged)`,
          notes: `PO Item: ${product.name}. Qty: ${item.qtyDamagedReceivedThisReceipt}. Status: Damaged. ${item.lineItemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId, supplierId: purchaseOrderDataForContext.supplierId,
        }, transaction);

        const receivedItemDamagedRef = doc(collection(receiptRef, "receivedItems"));
        transaction.set(receivedItemDamagedRef, {
          productId: item.productId, productName: product.name, quantityReceived: item.qtyDamagedReceivedThisReceipt,
          itemStatus: "Damaged", notes: item.lineItemNotes || "",
        } as Omit<ReceivedItem, "id">);
      }

      // --- Handle Missing Quantity ---
      if (item.qtyMissingReceivedThisReceipt > 0) {
        // No stock item update for missing items
        await recordStockMovement({
          productId: item.productId, productName: product.name, warehouseId: data.targetWarehouseId, warehouseName: targetWarehouse.name,
          type: 'PO_MISSING', quantityChanged: item.qtyMissingReceivedThisReceipt, // quantityChanged is the number missing
          quantityBefore: 0, quantityAfter: 0, // No physical stock change
          movementDate: data.receiptDate, userId: data.receivingUserId, userName: receivingUser.displayName || data.receivingUserId,
          reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}... (Missing)`,
          notes: `PO Item: ${product.name}. Qty: ${item.qtyMissingReceivedThisReceipt} declared Missing. ${item.lineItemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId, supplierId: purchaseOrderDataForContext.supplierId,
        }, transaction);

        const receivedItemMissingRef = doc(collection(receiptRef, "receivedItems"));
        transaction.set(receivedItemMissingRef, {
          productId: item.productId, productName: product.name, quantityReceived: item.qtyMissingReceivedThisReceipt, // Store missing qty here for the receipt record
          itemStatus: "Missing", notes: item.lineItemNotes || "",
        } as Omit<ReceivedItem, "id">);
      }

      // Update cumulative quantities on PurchaseOrderDetail
      const newCumulativeOk = (currentPODetail.receivedQuantity || 0) + item.qtyOkReceivedThisReceipt;
      const newCumulativeDamaged = (currentPODetail.receivedDamagedQuantity || 0) + item.qtyDamagedReceivedThisReceipt;
      const newCumulativeMissing = (currentPODetail.receivedMissingQuantity || 0) + item.qtyMissingReceivedThisReceipt;

      transaction.update(poDetailRef, {
        receivedQuantity: newCumulativeOk,
        receivedDamagedQuantity: newCumulativeDamaged,
        receivedMissingQuantity: newCumulativeMissing,
      });
    }
    // Update the main PO's updatedAt timestamp
    transaction.update(poRef, { updatedAt: now });
  }); // End of transaction

  return receiptRef.id;
};


async function getPODetailsForStatusCheck(poId: string): Promise<PurchaseOrderDetail[]> {
    const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
    const snapshot = await getDocs(query(detailsCollectionRef));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PurchaseOrderDetail));
}

export async function updatePOStatusAfterReceipt(purchaseOrderId: string, userId: string) {
    const poRef = doc(db, "purchaseOrders", purchaseOrderId);
    const poSnap = await getDoc(poRef); // Get latest PO data
    if (!poSnap.exists()) {
        console.error(`PO ${purchaseOrderId} not found during status update after receipt.`);
        return;
    }

    const purchaseOrder = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;
    const details = await getPODetailsForStatusCheck(purchaseOrderId);

    if (details.length === 0) {
        // If PO has no line items (edge case, possibly after all items were removed by an edit)
        // and it's not already in a terminal state, mark as Completed.
        if (purchaseOrder.status !== "Completed" && purchaseOrder.status !== "Canceled") {
            await updatePurchaseOrderStatus(purchaseOrderId, "Completed", userId);
        }
        return;
    }

    let allItemsFullyAccounted = true;
    let allExpectedPhysicalItemsReceivedAndNoMissing = true;

    for (const detail of details) {
        const totalAccountedFor = (detail.receivedQuantity || 0) + (detail.receivedDamagedQuantity || 0) + (detail.receivedMissingQuantity || 0);
        if (totalAccountedFor < detail.orderedQuantity) {
            allItemsFullyAccounted = false;
        }
        if ((detail.receivedMissingQuantity || 0) > 0) {
            allExpectedPhysicalItemsReceivedAndNoMissing = false;
        }
    }

    let newStatus: PurchaseOrderStatus;

    if (allItemsFullyAccounted) {
        if (allExpectedPhysicalItemsReceivedAndNoMissing) {
            // All ordered items are physically accounted for (OK or Damaged), and nothing is marked as missing cumulatively.
            newStatus = "FullyReceived";
        } else {
            // All ordered items are accounted for, but some were confirmed as missing.
            // The PO is reconciled in terms of quantity accounting.
            newStatus = "Completed";
        }
    } else {
        // Some items are still outstanding (not yet received as OK, Damaged, or Missing).
        newStatus = "PartiallyDelivered";
    }
    
    if (newStatus !== purchaseOrder.status) {
        await updatePurchaseOrderStatus(purchaseOrderId, newStatus, userId);
    } else {
        // Even if status doesn't change, update the 'updatedAt' timestamp.
        await updateDoc(poRef, { updatedAt: Timestamp.now() });
    }
}

    