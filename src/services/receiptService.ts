
import {
  collection, addDoc, Timestamp, writeBatch, doc, getDoc, updateDoc, query, where, getDocs, runTransaction
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Receipt, ReceivedItem, PurchaseOrder, PurchaseOrderDetail, StockMovementType, Warehouse, User as AppUser, ReceiptItemStatus, PurchaseOrderStatus
} from "@/types";
import { getUserById } from "./userService";
import { getWarehouseById } from "./warehouseService";
import { getProductById } from "./productService";
import { recordStockMovement, getStockItemRef } from "./stockService"; // Corrected: updateStockItem removed, getStockItemRef is used
// updatePurchaseOrderStatus is used internally, no need to import if it's in the same file and called directly.
// If it were in purchaseOrderService, it would be: import { updatePurchaseOrderStatus } from "./purchaseOrderService";


export interface CreateReceiptServiceItemData {
  productId: string;
  productName: string;
  poDetailId: string;
  qtyOkReceivedThisReceipt: number;
  qtyDamagedReceivedThisReceipt: number;
  qtyMissingReceivedThisReceipt: number;
  lineItemNotes?: string;
}

export interface CreateReceiptServiceData {
  purchaseOrderId: string;
  receiptDate: Timestamp;
  receivingUserId: string;
  targetWarehouseId: string;
  notes: string;
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
  const poSnapInitial = await getDoc(poRef);
  if (!poSnapInitial.exists()) throw new Error("Purchase Order not found.");
  const purchaseOrderDataForContext = poSnapInitial.data() as PurchaseOrder;

  const products = await Promise.all(
    data.itemsToProcess.map(item => getProductById(item.productId))
  );

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const item = data.itemsToProcess[i];
    if (!product || !product.isActive) {
      throw new Error(`Product ${item.productName} (ID: ${item.productId}) is not valid or active for receipt.`);
    }
  }

  const receiptRef = doc(collection(db, "receipts"));

  await runTransaction(db, async (transaction) => {
    const poDetailRefs = data.itemsToProcess.map(item =>
      doc(db, `purchaseOrders/${data.purchaseOrderId}/details/${item.poDetailId}`)
    );
    const poDetailSnaps = await Promise.all(
      poDetailRefs.map(ref => transaction.get(ref))
    );

    const stockUpdateOperations: Array<{
      stockRef: any; // Firestore DocumentReference
      updateData: Partial<any>; // More specific type if possible for StockItem
      createData?: any; // StockItem if creating
      exists: boolean;
    }> = [];

    const stockMovementRecords: Array<Omit<StockMovement, "id">> = [];
    const receivedItemRecords: Array<Omit<ReceivedItem, "id">> = [];


    for (let i = 0; i < data.itemsToProcess.length; i++) {
      const item = data.itemsToProcess[i];
      const poDetailSnap = poDetailSnaps[i];
      if (!poDetailSnap.exists()) {
        throw new Error(`Purchase Order Detail item ${item.poDetailId} for product ${item.productName} not found.`);
      }
      // Correctly scoped currentPODetail for this iteration
      const currentPODetailData = poDetailSnap.data() as PurchaseOrderDetail;
      const product = products[i]!;

      const processStockAndMovement = async (
        quantityReceived: number,
        status: "Ok" | "Damaged",
        movementType: StockMovementType,
        reasonSuffix: string
      ) => {
        if (quantityReceived <= 0) return;

        const stockItemRef = getStockItemRef(item.productId, data.targetWarehouseId);
        const stockItemSnap = await transaction.get(stockItemRef);
        const currentData = stockItemSnap.data() || {};
        const fieldToUpdate = status === "Ok" ? "quantity" : "damagedQuantity";
        const quantityBefore = currentData[fieldToUpdate] || 0;
        const quantityAfter = quantityBefore + quantityReceived;

        const updateData: Partial<any> = { // Using 'any' for updateData due to dynamic fieldToUpdate
          [fieldToUpdate]: quantityAfter,
          lastStockUpdate: now,
          updatedBy: data.receivingUserId,
        };
        
        if (status === "Ok") updateData.damagedQuantity = currentData.damagedQuantity || 0;
        else updateData.quantity = currentData.quantity || 0;

        if (!stockItemSnap.exists()) {
           stockUpdateOperations.push({
            stockRef,
            createData: {
              productId: item.productId,
              warehouseId: data.targetWarehouseId,
              quantity: status === "Ok" ? quantityAfter : 0,
              damagedQuantity: status === "Damaged" ? quantityAfter : 0,
              lastStockUpdate: now,
              updatedBy: data.receivingUserId,
            },
            exists: false
          });
        } else {
           stockUpdateOperations.push({ stockRef, updateData, exists: true });
        }

        stockMovementRecords.push({
          productId: item.productId,
          productName: product.name,
          warehouseId: data.targetWarehouseId,
          warehouseName: targetWarehouse.name,
          type: movementType,
          quantityChanged: quantityReceived,
          quantityBefore: quantityBefore,
          quantityAfter: quantityAfter,
          movementDate: data.receiptDate,
          userId: data.receivingUserId,
          userName: receivingUser.displayName || data.receivingUserId,
          reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}... (${reasonSuffix})`,
          notes: `PO Item: ${product.name}. Qty: ${quantityReceived}. Status: ${status}. ${item.lineItemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId,
          supplierId: purchaseOrderDataForContext.supplierId,
          createdAt: now,
        });

        receivedItemRecords.push({
          productId: item.productId,
          productName: product.name,
          quantityReceived: quantityReceived,
          itemStatus: status,
          notes: item.lineItemNotes || "",
        });
      };

      await processStockAndMovement(item.qtyOkReceivedThisReceipt, "Ok", 'INBOUND_PO', "OK");
      await processStockAndMovement(item.qtyDamagedReceivedThisReceipt, "Damaged", 'INBOUND_PO_DAMAGED', "Damaged");

      if (item.qtyMissingReceivedThisReceipt > 0) {
        stockMovementRecords.push({
          productId: item.productId,
          productName: product.name,
          warehouseId: data.targetWarehouseId,
          warehouseName: targetWarehouse.name,
          type: 'PO_MISSING',
          quantityChanged: item.qtyMissingReceivedThisReceipt,
          quantityBefore: 0, // Missing items don't affect existing stock levels directly
          quantityAfter: 0,
          movementDate: data.receiptDate,
          userId: data.receivingUserId,
          userName: receivingUser.displayName || data.receivingUserId,
          reason: `PO Receipt: ${data.purchaseOrderId.substring(0,8)}... (Missing)`,
          notes: `PO Item: ${product.name}. Qty: ${item.qtyMissingReceivedThisReceipt} declared Missing. ${item.lineItemNotes || ''}`.trim(),
          relatedDocumentId: data.purchaseOrderId,
          supplierId: purchaseOrderDataForContext.supplierId,
          createdAt: now,
        });
        receivedItemRecords.push({
          productId: item.productId,
          productName: product.name,
          quantityReceived: item.qtyMissingReceivedThisReceipt,
          itemStatus: "Missing",
          notes: item.lineItemNotes || "",
        });
      }

      // Update PO Detail cumulative quantities
      const newCumulativeOk = (currentPODetailData.receivedQuantity || 0) + item.qtyOkReceivedThisReceipt;
      const newCumulativeDamaged = (currentPODetailData.receivedDamagedQuantity || 0) + item.qtyDamagedReceivedThisReceipt;
      const newCumulativeMissing = (currentPODetailData.receivedMissingQuantity || 0) + item.qtyMissingReceivedThisReceipt;

      transaction.update(poDetailRefs[i], {
        receivedQuantity: newCumulativeOk,
        receivedDamagedQuantity: newCumulativeDamaged,
        receivedMissingQuantity: newCumulativeMissing,
      });
    }

    // All writes are now batched here
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

    stockUpdateOperations.forEach(op => {
      if (op.exists) {
        transaction.update(op.stockRef, op.updateData);
      } else if (op.createData) {
        transaction.set(op.stockRef, op.createData);
      }
    });

    stockMovementRecords.forEach(movement => {
      const movementRef = doc(collection(db, "stockMovements"));
      transaction.set(movementRef, movement);
    });

    receivedItemRecords.forEach(recItem => {
      const receivedItemRef = doc(collection(receiptRef, "receivedItems"));
      transaction.set(receivedItemRef, recItem);
    });

    transaction.update(poRef, { updatedAt: now });
  });

  return receiptRef.id;
};

async function getPODetailsForStatusCheck(poId: string): Promise<PurchaseOrderDetail[]> {
    const detailsCollectionRef = collection(db, `purchaseOrders/${poId}/details`);
    const snapshot = await getDocs(query(detailsCollectionRef));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as PurchaseOrderDetail));
}

// This function is defined locally now or imported if it's truly separate
// For now, assuming it's a local helper for updatePOStatusAfterReceipt.
// It would typically live in purchaseOrderService.ts
async function localUpdatePOStatus(
  purchaseOrderId: string,
  newStatus: PurchaseOrderStatus,
  userId: string
): Promise<void> {
  const poRef = doc(db, "purchaseOrders", purchaseOrderId);
  const updatePayload: Partial<PurchaseOrder> = { status: newStatus, updatedAt: Timestamp.now() };
  if (newStatus === "Completed" || newStatus === "Canceled") {
    const poSnap = await getDoc(poRef); // Read current PO to check completionDate
    if (poSnap.exists() && !poSnap.data().completionDate) {
      updatePayload.completionDate = Timestamp.now();
    }
  }
  await updateDoc(poRef, updatePayload);
}


export async function updatePOStatusAfterReceipt(purchaseOrderId: string, userId: string) {
    const poRef = doc(db, "purchaseOrders", purchaseOrderId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
        console.error(`PO ${purchaseOrderId} not found during status update after receipt.`);
        return;
    }

    //const purchaseOrder = { id: poSnap.id, ...poSnap.data() } as PurchaseOrder;
    const purchaseOrderData = poSnap.data() as Omit<PurchaseOrder, "id" | "details">; // Use Omit if details are not on main doc
    const details = await getPODetailsForStatusCheck(purchaseOrderId);

    if (details.length === 0) {
        if (purchaseOrderData.status !== "Completed" && purchaseOrderData.status !== "Canceled") {
            // Call local or imported updatePurchaseOrderStatus
            await localUpdatePOStatus(purchaseOrderId, "Completed", userId);
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
            newStatus = "FullyReceived";
        } else {
            // If all items are accounted for but some were missing, the PO is considered 'Completed'
            // as no more physical items are expected for those missing quantities.
            newStatus = "Completed";
        }
    } else {
        newStatus = "PartiallyDelivered";
    }

    if (newStatus !== purchaseOrderData.status) {
        await localUpdatePOStatus(purchaseOrderId, newStatus, userId);
    } else {
        // Even if status doesn't change (e.g. multiple partial deliveries), update the PO's updatedAt timestamp
        await updateDoc(poRef, { updatedAt: Timestamp.now() });
    }
}


    