
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getPurchaseOrderById, updatePurchaseOrderStatus, updatePurchaseOrderDetailsAndCosts, type UpdatePOWithChangesData, recordSupplierSolution, type RecordSupplierSolutionData } from "@/services/purchaseOrderService";
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderDetail, QuotationAdditionalCost, Warehouse as AppWarehouse, User as AppUser, SupplierSolutionType } from "@/types";
import { QUOTATION_ADDITIONAL_COST_TYPES, PURCHASE_ORDER_STATUSES, SUPPLIER_SOLUTION_TYPES } from "@/types"; 
import { Timestamp, deleteField, runTransaction, collection as firestoreCollection, query as firestoreQuery, getDocs as firestoreGetDocs, doc as firestoreDoc } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icons } from "@/components/icons";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { format, isValid, parseISO } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription as ShadDialogDescription, DialogFooter, DialogHeader, DialogTitle as ShadDialogTitle, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm, useFieldArray, Controller, useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { getActiveWarehouses } from "@/services/warehouseService";
import { createReceipt, updatePOStatusAfterReceipt, type CreateReceiptServiceData } from "@/services/receiptService";
import { db } from "@/lib/firebase";
import { updateRequisitionQuantitiesPostConfirmation, handleRequisitionUpdateForPOCancellation } from "@/services/requisitionService";


const poDetailItemSchema = z.object({
  id: z.string().optional(),
  productId: z.string(),
  productName: z.string(),
  orderedQuantity: z.coerce.number().min(0.001, "Quantity must be positive."),
  unitPrice: z.coerce.number().min(0, "Price must be non-negative."),
  notes: z.string().optional(),
});

const editPOFormSchema = z.object({
  notes: z.string().optional(),
  expectedDeliveryDate: z.date().optional(),
  additionalCosts: z.array(z.object({
    id: z.string().optional(), 
    description: z.string().min(1, "Cost description is required."),
    amount: z.coerce.number().min(0, "Cost amount must be non-negative."),
    type: z.enum(QUOTATION_ADDITIONAL_COST_TYPES),
  })).optional(),
  details: z.array(poDetailItemSchema).min(1, "At least one product item is required."),
});

type EditPOFormData = z.infer<typeof editPOFormSchema>;


const recordReceiptItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  poDetailId: z.string(),
  orderedQuantity: z.number(), 
  
  alreadyReceivedOkQuantity: z.number().default(0), 
  alreadyReceivedDamagedQuantity: z.number().default(0),
  alreadyReceivedMissingQuantity: z.number().default(0),

  qtyOkReceivedThisReceipt: z.coerce.number().min(0, "OK Qty must be non-negative.").default(0),
  qtyDamagedReceivedThisReceipt: z.coerce.number().min(0, "Damaged Qty must be non-negative.").default(0),
  qtyMissingReceivedThisReceipt: z.coerce.number().min(0, "Missing Qty must be non-negative.").default(0),
  
  lineItemNotes: z.string().optional(), 
}).superRefine((data, ctx) => {
    const trulyOutstandingForThisReceipt = Math.max(0, data.orderedQuantity - (data.alreadyReceivedOkQuantity + data.alreadyReceivedDamagedQuantity + data.alreadyReceivedMissingQuantity));
    const totalEnteredThisReceipt = data.qtyOkReceivedThisReceipt + data.qtyDamagedReceivedThisReceipt + data.qtyMissingReceivedThisReceipt;

    if (totalEnteredThisReceipt > trulyOutstandingForThisReceipt) {
        ctx.addIssue({
            path: ["qtyOkReceivedThisReceipt"], 
            message: `Total quantities entered (${totalEnteredThisReceipt}) for this receipt cannot exceed the truly outstanding quantity (${trulyOutstandingForThisReceipt}).`,
        });
    }
});


const recordReceiptFormSchema = z.object({
  receiptDate: z.date({ required_error: "Receipt date is required." }),
  targetWarehouseId: z.string().min(1, "Target warehouse is required."),
  overallReceiptNotes: z.string().optional(),
  itemsToProcess: z.array(recordReceiptItemSchema)
    .min(1, "At least one item must be specified for receipt.")
    .superRefine((items, ctx) => {
        const anyQuantityEntered = items.some(item => 
            item.qtyOkReceivedThisReceipt > 0 || 
            item.qtyDamagedReceivedThisReceipt > 0 || 
            item.qtyMissingReceivedThisReceipt > 0
        );
        if (!anyQuantityEntered) {
             ctx.addIssue({
                path: [], 
                message: "Please enter received (OK, Damaged, or Missing) quantities for at least one item.",
            });
        }
    }),
});

type RecordReceiptFormData = z.infer<typeof recordReceiptFormSchema>;

const supplierSolutionFormSchema = z.object({
  solutionType: z.enum(SUPPLIER_SOLUTION_TYPES, { required_error: "Supplier solution type is required."}),
  solutionDetails: z.string().min(10, "Please provide at least 10 characters of detail for the solution."),
});
type SupplierSolutionFormData = z.infer<typeof supplierSolutionFormSchema>;


export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const purchaseOrderId = params.id as string;
  const { toast } = useToast();
  const { appUser, role, currentUser } = useAuth();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const [isEditPODialogOpen, setIsEditPODialogOpen] = useState(false);
  const [isSubmittingEditPO, setIsSubmittingEditPO] = useState(false);

  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [availableWarehouses, setAvailableWarehouses] = useState<AppWarehouse[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);

  const [isSupplierSolutionDialogOpen, setIsSupplierSolutionDialogOpen] = useState(false);
  const [isSubmittingSolution, setIsSubmittingSolution] = useState(false);
  const [isAcceptOriginalConfirmOpen, setIsAcceptOriginalConfirmOpen] = useState(false);


  const editPOForm = useForm<EditPOFormData>({
    resolver: zodResolver(editPOFormSchema),
    defaultValues: {
        notes: "",
        expectedDeliveryDate: undefined,
        additionalCosts: [],
        details: [],
    }
  });

  const { fields: additionalCostFields, append: appendAdditionalCost, remove: removeAdditionalCost } = useFieldArray({
    control: editPOForm.control,
    name: "additionalCosts",
  });


  const receiptForm = useForm<RecordReceiptFormData>({
    resolver: zodResolver(recordReceiptFormSchema),
    defaultValues: {
      receiptDate: new Date(),
      itemsToProcess: [],
      overallReceiptNotes: "",
    }
  });
  const { fields: receiptItemsFields, replace: replaceReceiptItems } = useFieldArray({
    control: receiptForm.control, name: "itemsToProcess"
  });
  
  const supplierSolutionForm = useForm<SupplierSolutionFormData>({
    resolver: zodResolver(supplierSolutionFormSchema),
  });


  const fetchPOData = useCallback(async () => {
    if (!purchaseOrderId || !appUser) return;
    setIsLoading(true);
    try {
      const fetchedPO = await getPurchaseOrderById(purchaseOrderId);
      if (fetchedPO) {
        setPurchaseOrder(fetchedPO);
      } else {
        toast({ title: "Error", description: "Purchase Order not found.", variant: "destructive" });
        router.replace("/purchase-orders");
      }
    } catch (error) {
      console.error("Error fetching PO details:", error);
      toast({ title: "Error", description: "Failed to fetch Purchase Order details.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [purchaseOrderId, appUser, router, toast]);

  useEffect(() => {
    fetchPOData();
  }, [fetchPOData]);

  const handleStatusChange = async (newStatus: PurchaseOrderStatus) => {
    if (!purchaseOrder || !currentUser || purchaseOrder.status === newStatus) return;
    setIsUpdating(true);
    try {
      await updatePurchaseOrderStatus(purchaseOrderId, newStatus, currentUser.uid);
      toast({ title: `PO Status Updated to ${newStatus}`, description: `Purchase Order status successfully changed.` });
      fetchPOData();
    } catch (error: any) {
      console.error(`Error changing PO status to ${newStatus}:`, error);
      toast({ title: "Update Failed", description: error.message || `Could not change PO status to ${newStatus}.`, variant: "destructive" });
    }
    setIsUpdating(false);
  };

  const handleOpenEditPODialog = () => {
    if (!purchaseOrder) return;
    const sourceData = (purchaseOrder.status === 'PendingInternalReview' && purchaseOrder.originalDetails) 
      ? purchaseOrder 
      : purchaseOrder; 

    editPOForm.reset({
      notes: sourceData.notes || "",
      expectedDeliveryDate: sourceData.expectedDeliveryDate?.toDate(),
      additionalCosts: sourceData.additionalCosts?.map(ac => ({...ac, id: ac.id || Math.random().toString(36).substring(7), amount: Number(ac.amount)})) || [],
      details: sourceData.details?.map(d => ({
        id: d.id, 
        productId: d.productId,
        productName: d.productName,
        orderedQuantity: d.orderedQuantity,
        unitPrice: d.unitPrice,
        notes: d.notes || "",
      })) || [],
    });
    setIsEditPODialogOpen(true);
  };

  const handleEditPOSubmit = async (data: EditPOFormData) => {
    if (!purchaseOrder || !currentUser) return;
    setIsSubmittingEditPO(true);

    const payload: UpdatePOWithChangesData = {
      notes: data.notes,
      expectedDeliveryDate: data.expectedDeliveryDate ? Timestamp.fromDate(data.expectedDeliveryDate) : undefined,
      additionalCosts: data.additionalCosts?.map(cost => ({
        description: cost.description,
        amount: cost.amount,
        type: cost.type,
      })) || [],
      details: data.details.map(d => ({
        productId: d.productId,
        productName: d.productName,
        orderedQuantity: d.orderedQuantity,
        unitPrice: d.unitPrice,
        notes: d.notes || "",
      })),
    };

    try {
      await updatePurchaseOrderDetailsAndCosts(purchaseOrderId, payload);
      toast({ title: "Supplier's Proposal Recorded", description: "PO details updated. Now awaiting internal review." });
      await handleStatusChange("PendingInternalReview"); 
      setIsEditPODialogOpen(false);
      fetchPOData(); 
    } catch (error: any) {
      console.error("Error updating PO with supplier changes:", error);
      toast({ title: "Update Failed", description: error.message || "Could not update Purchase Order.", variant: "destructive" });
    }
    setIsSubmittingEditPO(false);
  };

  const handleOpenAcceptOriginalDialog = () => {
    setIsAcceptOriginalConfirmOpen(true);
  };

  const handleAcceptOriginalPOAndConfirm = async () => {
    if (!purchaseOrder || !currentUser || !purchaseOrder.originalDetails || purchaseOrder.originalDetails.length === 0) {
      toast({ title: "Error", description: "Cannot proceed: PO data or original details missing.", variant: "destructive" });
      return;
    }
    setIsUpdating(true);
    try {
      await runTransaction(db, async (transaction) => {
        const poRef = firestoreDoc(db, "purchaseOrders", purchaseOrderId);
        const poSnap = await transaction.get(poRef);

        if (!poSnap.exists()) {
          throw new Error("Purchase Order not found during transaction.");
        }
        const currentPODataFromSnap = poSnap.data() as PurchaseOrder;
        if (!currentPODataFromSnap.originalDetails || currentPODataFromSnap.originalDetails.length === 0) {
          throw new Error("No original details found to revert to.");
        }

        const updateDataForMainPO: any = {
          notes: currentPODataFromSnap.originalNotes,
          expectedDeliveryDate: currentPODataFromSnap.originalExpectedDeliveryDate,
          additionalCosts: currentPODataFromSnap.originalAdditionalCosts || [],
          productsSubtotal: currentPODataFromSnap.originalProductsSubtotal,
          totalAmount: currentPODataFromSnap.originalTotalAmount,
          status: "ConfirmedBySupplier" as PurchaseOrderStatus,
          updatedAt: Timestamp.now(),
          originalDetails: deleteField(),
          originalAdditionalCosts: deleteField(),
          originalProductsSubtotal: deleteField(),
          originalTotalAmount: deleteField(),
          originalNotes: deleteField(),
          originalExpectedDeliveryDate: deleteField(),
        };
        transaction.update(poRef, updateDataForMainPO);

        const detailsCollectionRef = firestoreCollection(db, "purchaseOrders", purchaseOrderId, "details");
        // Fetch existing detail document references BEFORE the transaction loop if needed
        // For this specific 'Accept Original' case, we are deleting all current and re-adding original.
        const currentDetailsSnapshot = await firestoreGetDocs(firestoreQuery(detailsCollectionRef)); 

        currentDetailsSnapshot.forEach(docSnap => {
          transaction.delete(docSnap.ref);
        });

        for (const originalDetailItem of currentPODataFromSnap.originalDetails) {
          const { id: oldDocId, ...detailDataToSet } = originalDetailItem;
          const newDetailRef = firestoreDoc(detailsCollectionRef); 
          transaction.set(newDetailRef, detailDataToSet);
        }
      });

      await updateRequisitionQuantitiesPostConfirmation(purchaseOrderId, currentUser.uid, purchaseOrder.originalDetails);
      toast({ title: "Original PO Confirmed", description: "Purchase Order reverted to original terms and confirmed." });
      fetchPOData();
      setIsAcceptOriginalConfirmOpen(false);

    } catch (error: any) {
      console.error("Error accepting original PO:", error);
      toast({ title: "Update Failed", description: error.message || "Could not accept original Purchase Order.", variant: "destructive" });
    }
    setIsUpdating(false);
  };


  const handleOpenReceiptDialog = async () => {
    if (!purchaseOrder || !purchaseOrder.details) return;
    setIsLoadingWarehouses(true);
    try {
        let activeWarehouses = await getActiveWarehouses();
        if (role === 'employee' && appUser?.assignedWarehouseIds && appUser.assignedWarehouseIds.length > 0) {
            activeWarehouses = activeWarehouses.filter(wh => appUser.assignedWarehouseIds!.includes(wh.id));
        }
        setAvailableWarehouses(activeWarehouses);

        const itemsForReceiptProcessing = purchaseOrder.details
            .filter(d => {
                const totalAccountedFor = (d.receivedQuantity || 0) + (d.receivedDamagedQuantity || 0) + (d.receivedMissingQuantity || 0);
                return d.orderedQuantity > totalAccountedFor;
            })
            .map(d => {
                return {
                    productId: d.productId,
                    productName: d.productName,
                    poDetailId: d.id,
                    orderedQuantity: d.orderedQuantity,
                    alreadyReceivedOkQuantity: d.receivedQuantity || 0,
                    alreadyReceivedDamagedQuantity: d.receivedDamagedQuantity || 0,
                    alreadyReceivedMissingQuantity: d.receivedMissingQuantity || 0,
                    qtyOkReceivedThisReceipt: 0, 
                    qtyDamagedReceivedThisReceipt: 0,
                    qtyMissingReceivedThisReceipt: 0,
                    lineItemNotes: "",
                };
            });

        if (itemsForReceiptProcessing.length === 0) {
            toast({ title: "No Items to Receive", description: "All items on this PO have been fully accounted for (OK, Damaged, or Missing).", variant: "default" });
            return;
        }
        
        receiptForm.reset({
            receiptDate: new Date(),
            targetWarehouseId: activeWarehouses.find(wh => wh.isDefault)?.id || (activeWarehouses.length > 0 ? activeWarehouses[0].id : ""),
            overallReceiptNotes: "",
            itemsToProcess: itemsForReceiptProcessing,
        });
        setIsReceiptDialogOpen(true);

    } catch (error) {
        console.error("Error preparing receipt dialog:", error);
        toast({ title: "Error", description: "Could not load data for receipt.", variant: "destructive" });
    }
    setIsLoadingWarehouses(false);
  };

  const onReceiptSubmit = async (data: RecordReceiptFormData) => {
    if (!purchaseOrder || !currentUser) return;
    setIsSubmittingReceipt(true);

    const servicePayloadItems: CreateReceiptServiceData['itemsToProcess'] = data.itemsToProcess
      .filter(formItem => 
        formItem.qtyOkReceivedThisReceipt > 0 || 
        formItem.qtyDamagedReceivedThisReceipt > 0 || 
        formItem.qtyMissingReceivedThisReceipt > 0
      )
      .map(formItem => ({
        productId: formItem.productId,
        productName: formItem.productName,
        poDetailId: formItem.poDetailId,
        qtyOkReceivedThisReceipt: formItem.qtyOkReceivedThisReceipt,
        qtyDamagedReceivedThisReceipt: formItem.qtyDamagedReceivedThisReceipt,
        qtyMissingReceivedThisReceipt: formItem.qtyMissingReceivedThisReceipt,
        lineItemNotes: formItem.lineItemNotes || "",
      }));
    
    if (servicePayloadItems.length === 0) {
        receiptForm.setError("itemsToProcess", { type: "manual", message: "No quantities were entered for receipt (OK, Damaged, or Missing)." });
        setIsSubmittingReceipt(false);
        return;
    }

    const payload: CreateReceiptServiceData = {
        purchaseOrderId: purchaseOrder.id,
        receiptDate: Timestamp.fromDate(data.receiptDate),
        receivingUserId: currentUser.uid,
        targetWarehouseId: data.targetWarehouseId,
        notes: data.overallReceiptNotes || "",
        itemsToProcess: servicePayloadItems,
    };

    try {
        await createReceipt(payload);
        // updatePOStatusAfterReceipt is now called within createReceipt itself
        toast({ title: "Receipt Recorded", description: "Stock receipt successfully recorded. PO status updated." });
        setIsReceiptDialogOpen(false);
        fetchPOData(); 
    } catch (error: any) {
        console.error("Error recording receipt:", error);
        toast({ title: "Receipt Failed", description: error.message || "Could not record receipt.", variant: "destructive" });
    }
    setIsSubmittingReceipt(false);
  };
  
  const handleOpenSupplierSolutionDialog = () => {
    if (!purchaseOrder) return;
    supplierSolutionForm.reset({
        solutionType: purchaseOrder.supplierAgreedSolutionType || undefined,
        solutionDetails: purchaseOrder.supplierAgreedSolutionDetails || "",
    });
    setIsSupplierSolutionDialogOpen(true);
  };
  
  const onSupplierSolutionSubmit = async (data: SupplierSolutionFormData) => {
    if (!purchaseOrder || !currentUser) return;
    setIsSubmittingSolution(true);
    try {
        const payload: RecordSupplierSolutionData = {
            supplierAgreedSolutionType: data.solutionType,
            supplierAgreedSolutionDetails: data.solutionDetails,
        };
        await recordSupplierSolution(purchaseOrderId, payload, currentUser.uid);
        toast({ title: "Supplier Solution Recorded", description: `Solution '${data.solutionType}' has been recorded for this PO.`});
        setIsSupplierSolutionDialogOpen(false);
        fetchPOData(); 
    } catch (error: any) {
        console.error("Error recording supplier solution:", error);
        toast({ title: "Solution Update Failed", description: error.message || "Could not record supplier solution.", variant: "destructive"});
    }
    setIsSubmittingSolution(false);
  };


  const formatTimestampDate = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    let date: Date;
    if (timestamp instanceof Timestamp) date = timestamp.toDate();
    else if (typeof timestamp === 'string') date = parseISO(timestamp); 
    else return "Invalid Date Object";
    return isValid(date) ? format(date, "PPP") : "Invalid Date";
  };

  const getStatusBadgeVariant = (status?: PurchaseOrderStatus) => {
    if (!status) return "secondary";
    switch (status) {
      case "Pending": return "outline";
      case "SentToSupplier": return "default";
      case "ChangesProposedBySupplier": return "default";
      case "PendingInternalReview": return "default";
      case "ConfirmedBySupplier": return "default";
      case "RejectedBySupplier": return "destructive";
      case "PartiallyDelivered": return "default"; 
      case "AwaitingFutureDelivery": return "default"; 
      case "FullyReceived": return "default";
      case "Completed": return "default";
      case "Canceled": return "destructive";
      default: return "secondary";
    }
  };

  const getStatusBadgeClass = (status?: PurchaseOrderStatus) => {
    if (!status) return "";
    switch (status) {
      case "SentToSupplier": return "bg-blue-500 hover:bg-blue-600 text-white";
      case "ChangesProposedBySupplier": return "bg-orange-400 hover:bg-orange-500 text-black";
      case "PendingInternalReview": return "bg-purple-500 hover:bg-purple-600 text-white";
      case "ConfirmedBySupplier": return "bg-teal-500 hover:bg-teal-600 text-white";
      case "PartiallyDelivered": return "bg-yellow-500 hover:bg-yellow-600 text-black"; 
      case "AwaitingFutureDelivery": return "bg-cyan-500 hover:bg-cyan-600 text-white"; 
      case "FullyReceived": return "bg-sky-500 hover:bg-sky-600 text-white";
      case "Completed": return "bg-green-500 hover:bg-green-600 text-white";
      default: return "";
    }
  };

  if (isLoading) {
    return (<div className="space-y-4"><PageHeader title="Purchase Order Details" description="Loading PO information..." /><Skeleton className="h-48 w-full" /><Skeleton className="h-64 w-full" /></div>);
  }
  if (!purchaseOrder) {
    return (<div className="space-y-4"><PageHeader title="Purchase Order Not Found" description="The requested PO could not be loaded." /><Button onClick={() => router.push("/purchase-orders")} variant="outline">Back to List</Button></div>);
  }

  const canManagePO = role === 'admin' || role === 'superadmin';
  const poStatus = purchaseOrder.status;

  const showSendToSupplier = canManagePO && poStatus === "Pending";
  const showSentToSupplierActions = canManagePO && poStatus === "SentToSupplier";
  const showChangesProposedActions = canManagePO && poStatus === "ChangesProposedBySupplier"; 
  const showPendingInternalReviewActions = canManagePO && poStatus === "PendingInternalReview";
  const showAcceptOriginalPOButton = canManagePO && poStatus === "PendingInternalReview" && purchaseOrder.originalDetails && purchaseOrder.originalDetails.length > 0;
  
  const showRecordReceipt = canManagePO && (poStatus === "ConfirmedBySupplier" || poStatus === "PartiallyDelivered" || poStatus === "AwaitingFutureDelivery");
  const showRecordSupplierSolutionButton = canManagePO && poStatus === "PartiallyDelivered";

  const showCancelPO = canManagePO && !["FullyReceived", "Completed", "Canceled", "RejectedBySupplier", "PartiallyDelivered", "AwaitingFutureDelivery"].includes(poStatus);


  const renderComparisonTable = (originalItems: PurchaseOrderDetail[], proposedItems: PurchaseOrderDetail[], itemType: "Details" | "Costs") => (
    <Table>
      <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Orig. Qty</TableHead><TableHead className="text-right">Prop. Qty</TableHead><TableHead className="text-right">Orig. Price</TableHead><TableHead className="text-right">Prop. Price</TableHead><TableHead>Notes (Proposed)</TableHead></TableRow></TableHeader>
      <TableBody>
        {proposedItems.map(pItem => {
          const oItem = originalItems.find(oi => oi.productId === pItem.productId);
          return (
            <TableRow key={pItem.productId}>
              <TableCell>{pItem.productName}</TableCell>
              <TableCell className="text-right">{oItem?.orderedQuantity || 'N/A'}</TableCell>
              <TableCell className="text-right">{pItem.orderedQuantity}</TableCell>
              <TableCell className="text-right">${(oItem?.unitPrice || 0).toFixed(2)}</TableCell>
              <TableCell className="text-right">${(pItem.unitPrice || 0).toFixed(2)}</TableCell>
              <TableCell className="text-xs max-w-[150px] truncate" title={pItem.notes}>{pItem.notes || "N/A"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
   const renderAdditionalCostsTable = (costs: QuotationAdditionalCost[]) => (
    <Table>
        <TableHeader><TableRow><TableHead>Description</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
            {costs.length > 0 ? costs.map((cost, index) => (
                <TableRow key={index}>
                    <TableCell>{cost.description}</TableCell>
                    <TableCell>{cost.type}</TableCell>
                    <TableCell className="text-right">${Number(cost.amount).toFixed(2)}</TableCell>
                </TableRow>
            )) : <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No additional costs</TableCell></TableRow>}
        </TableBody>
    </Table>
  );


  return (
    <>
      <PageHeader
        title={`Purchase Order: ${purchaseOrder.id.substring(0,8)}...`}
        description={`Supplier: ${purchaseOrder.supplierName || purchaseOrder.supplierId}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {showSendToSupplier && (<Button onClick={() => handleStatusChange("SentToSupplier")} disabled={isUpdating}>{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Send className="mr-2 h-4 w-4" />}Send to Supplier</Button>)}
            
            {showSentToSupplierActions && (
              <>
                <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="default" className="bg-teal-500 hover:bg-teal-600">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}Record Supplier Confirmation</Button>
                <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}Record Supplier Rejection</Button>
                <Button onClick={handleOpenEditPODialog} disabled={isUpdating || isSubmittingEditPO} variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">{isUpdating || isSubmittingEditPO ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Edit className="mr-2 h-4 w-4" />}Record Supplier's Proposal & Review</Button>
              </>
            )}

            {showPendingInternalReviewActions && (
                 <>
                    {showAcceptOriginalPOButton && (
                        <AlertDialog open={isAcceptOriginalConfirmOpen} onOpenChange={setIsAcceptOriginalConfirmOpen}>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="border-blue-500 text-blue-600 hover:bg-blue-50" disabled={isUpdating} onClick={handleOpenAcceptOriginalDialog}>
                                    <Icons.Check className="mr-2 h-4 w-4" />Accept Original & Confirm
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Confirm Acceptance of Original PO Terms</AlertDialogTitle>
                                     <AlertDialogDescription asChild>
                                      <div className="text-sm text-muted-foreground">
                                        <p>
                                          You are about to override the supplier's proposed changes and confirm the Purchase Order based on its <strong>original</strong> terms.
                                        </p>
                                        <p className="mt-2">
                                          Please ensure you have explicit confirmation from the supplier that they can now fulfill the original order details (quantities, prices, delivery dates, etc.) despite their previous counter-offer.
                                        </p>
                                        <p className="mt-2">
                                          If the supplier <strong>cannot</strong> fulfill the original terms, you should either 'Reject This Revised PO' or use 'Needs Further Negotiation / Re-edit' to adjust the PO to what the supplier can actually provide.
                                        </p>
                                        <p className="mt-2">
                                          Proceeding will:
                                        </p>
                                        <ul className="list-disc pl-5 mt-1 text-xs">
                                          <li>Discard the supplier's proposed changes.</li>
                                          <li>Set the PO status to 'ConfirmedBySupplier' based on original terms.</li>
                                          <li>Update requisition quantities accordingly.</li>
                                        </ul>
                                      </div>
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleAcceptOriginalPOAndConfirm} disabled={isUpdating} className="bg-blue-500 hover:bg-blue-600">
                                        {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : null} Confirm Original & Proceed
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="default" className="bg-teal-500 hover:bg-teal-600">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}Confirm This Revised PO</Button>
                    <Button onClick={() => handleStatusChange("ChangesProposedBySupplier")} disabled={isUpdating} variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Edit className="mr-2 h-4 w-4" />}Needs Further Negotiation / Re-edit</Button>
                    <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}Reject This Revised PO</Button>
                </>
            )}

            {showRecordReceipt && (<Button onClick={handleOpenReceiptDialog} disabled={isUpdating || isLoadingWarehouses} variant="default"><Icons.Package className="mr-2 h-4 w-4" /> Record Receipt</Button>)}
            
            {showRecordSupplierSolutionButton && (<Button onClick={handleOpenSupplierSolutionDialog} disabled={isUpdating || isSubmittingSolution} variant="outline" className="border-yellow-500 text-yellow-600 hover:bg-yellow-50"><Icons.Edit className="mr-2 h-4 w-4" /> Record Supplier Solution</Button>)}
            
            {showCancelPO && (<AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={isUpdating}>{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Delete className="mr-2 h-4 w-4" />}Cancel PO</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure you want to cancel this Purchase Order?</AlertDialogTitle><AlertDialogDescription>This action will mark the PO as 'Canceled'. If canceled before supplier confirmation, pending quantities on the requisition will be adjusted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep PO</AlertDialogCancel><AlertDialogAction onClick={() => handleStatusChange("Canceled")} className="bg-destructive hover:bg-destructive/90">Confirm Cancellation</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>)}
            
            <Button onClick={() => router.back()} variant="outline">Back</Button>
          </div>
        }
      />

      {(poStatus === "ChangesProposedBySupplier" || poStatus === "PendingInternalReview") && !purchaseOrder.originalDetails && (
        <Card className="my-4 border-l-4 border-orange-500">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-orange-700">Review Supplier Communication</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The supplier may have proposed changes. Use 'Record Supplier's Proposal & Review' to input these changes for formal review.
              A detailed side-by-side comparison view is planned for a future update.
            </p>
          </CardContent>
        </Card>
      )}

      {purchaseOrder.status === "PendingInternalReview" && purchaseOrder.originalDetails && (
        <Card className="my-6">
          <CardHeader>
            <CardTitle className="font-headline text-xl">Original vs. Proposed Order Comparison</CardTitle>
            <CardDescription>Review the differences between the original order and the supplier's proposed changes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4 p-4 border rounded-md bg-muted/30">
                <h3 className="text-lg font-semibold">Original Order</h3>
                <p className="text-sm"><span className="font-medium text-muted-foreground">Notes:</span> {purchaseOrder.originalNotes || "N/A"}</p>
                <p className="text-sm"><span className="font-medium text-muted-foreground">Expected Delivery:</span> {formatTimestampDate(purchaseOrder.originalExpectedDeliveryDate)}</p>
                
                <h4 className="text-md font-semibold pt-2">Original Items:</h4>
                {purchaseOrder.originalDetails && purchaseOrder.originalDetails.length > 0 ? (
                  renderComparisonTable(purchaseOrder.originalDetails, purchaseOrder.originalDetails, "Details")
                ) : <p className="text-sm text-muted-foreground">No original items recorded.</p>}
                
                <h4 className="text-md font-semibold pt-2">Original Additional Costs:</h4>
                {renderAdditionalCostsTable(purchaseOrder.originalAdditionalCosts || [])}
                
                <div className="text-sm font-semibold pt-2 border-t mt-2">
                  <p>Original Subtotal: ${Number(purchaseOrder.originalProductsSubtotal || 0).toFixed(2)}</p>
                  <p>Original Total: ${Number(purchaseOrder.originalTotalAmount || 0).toFixed(2)}</p>
                </div>
              </div>

              <div className="space-y-4 p-4 border rounded-md bg-card">
                <h3 className="text-lg font-semibold text-primary">Supplier's Proposed Order (Current)</h3>
                <p className="text-sm"><span className="font-medium text-muted-foreground">Notes:</span> {purchaseOrder.notes || "N/A"}</p>
                <p className="text-sm"><span className="font-medium text-muted-foreground">Expected Delivery:</span> {formatTimestampDate(purchaseOrder.expectedDeliveryDate)}</p>
                
                <h4 className="text-md font-semibold pt-2">Proposed Items:</h4>
                {purchaseOrder.details && purchaseOrder.details.length > 0 ? (
                   renderComparisonTable(purchaseOrder.originalDetails || [], purchaseOrder.details, "Details")
                ) : <p className="text-sm text-muted-foreground">No proposed items recorded.</p>}
                 
                <h4 className="text-md font-semibold pt-2">Proposed Additional Costs:</h4>
                {renderAdditionalCostsTable(purchaseOrder.additionalCosts || [])}
                
                 <div className="text-sm font-semibold pt-2 border-t mt-2">
                  <p>Proposed Subtotal: ${Number(purchaseOrder.productsSubtotal || 0).toFixed(2)}</p>
                  <p>Proposed Total: ${Number(purchaseOrder.totalAmount || 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}


      <div className="grid gap-6 md:grid-cols-3 mt-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">PO Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">PO ID:</span><span className="font-medium truncate max-w-[150px]">{purchaseOrder.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Origin Requisition:</span>
              <Link href={`/requisitions/${purchaseOrder.originRequisitionId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">
                {purchaseOrder.originRequisitionId}
              </Link>
            </div>
            {purchaseOrder.quotationReferenceId && (
              <div className="flex justify-between"><span className="text-muted-foreground">Quotation Ref:</span>
                <Link href={`/quotations/${purchaseOrder.quotationReferenceId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">
                  {purchaseOrder.quotationReferenceId}
                </Link>
              </div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier:</span><span className="font-medium">{purchaseOrder.supplierName || purchaseOrder.supplierId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Order Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.orderDate)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Expected Delivery:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.expectedDeliveryDate)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(poStatus)} className={getStatusBadgeClass(poStatus)}>
                {poStatus}
              </Badge>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{purchaseOrder.creationUserName || purchaseOrder.creationUserId}</span></div>
            {purchaseOrder.completionDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Completion Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.completionDate)}</span></div>
            )}
            
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Products Subtotal:</span><span className="font-medium">${Number(purchaseOrder.productsSubtotal || 0).toFixed(2)}</span></div>
            {purchaseOrder.additionalCosts && purchaseOrder.additionalCosts.length > 0 && (
               <>
                 <p className="text-xs font-semibold text-muted-foreground">Additional Costs:</p>
                 {purchaseOrder.additionalCosts.map((cost, index) => (
                   <div key={index} className="flex justify-between pl-2 text-xs">
                     <span>{cost.description} ({cost.type})</span>
                     <span className="font-medium">${Number(cost.amount).toFixed(2)}</span>
                   </div>
                 ))}
               </>
            )}
            <div className="flex justify-between text-md font-semibold pt-1"><span className="text-muted-foreground">Total PO Amount:</span><span>${Number(purchaseOrder.totalAmount || 0).toFixed(2)}</span></div>
            <Separator />
            
            <div><span className="text-muted-foreground">Notes:</span><p className="font-medium whitespace-pre-wrap">{purchaseOrder.notes || "N/A"}</p></div>
            {purchaseOrder.supplierAgreedSolutionType && (
              <>
                <Separator />
                <div>
                  <span className="text-muted-foreground">Supplier Solution Type:</span>
                  <p className="font-medium">{purchaseOrder.supplierAgreedSolutionType.replace(/([A-Z])/g, ' $1').trim()}</p>
                </div>
                {purchaseOrder.supplierAgreedSolutionDetails && (
                  <div>
                    <span className="text-muted-foreground">Solution Details:</span>
                    <p className="font-medium whitespace-pre-wrap">{purchaseOrder.supplierAgreedSolutionDetails}</p>
                  </div>
                )}
              </>
            )}
            
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{new Date(purchaseOrder.updatedAt.seconds * 1000).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created At:</span><span className="font-medium">{new Date(purchaseOrder.createdAt.seconds * 1000).toLocaleString()}</span></div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Ordered Products (Current State)</CardTitle>
            <CardDescription>List of products reflecting current PO details.</CardDescription>
          </CardHeader>
          <CardContent>
            {purchaseOrder.details && purchaseOrder.details.length > 0 ? (
              <ScrollArea className="h-[calc(100vh-25rem)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">OK Rec'd</TableHead>
                      <TableHead className="text-right">Damaged</TableHead>
                      <TableHead className="text-right">Missing</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrder.details.map((item) => (
                      <TableRow key={item.id || item.productId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.orderedQuantity}</TableCell>
                        <TableCell className="text-right">${Number(item.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.receivedQuantity || 0}</TableCell>
                        <TableCell className="text-right">{item.receivedDamagedQuantity || 0}</TableCell>
                        <TableCell className="text-right">{item.receivedMissingQuantity || 0}</TableCell>
                        <TableCell className="whitespace-pre-wrap text-xs max-w-[150px] truncate" title={item.notes}>{item.notes || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <p>No products listed for this purchase order.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isEditPODialogOpen} onOpenChange={setIsEditPODialogOpen}>
        <DialogContent className="sm:max-w-2xl md:max-w-3xl flex flex-col max-h-[90vh]">
          <Form {...editPOForm}>
            <form onSubmit={editPOForm.handleSubmit(handleEditPOSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <ShadDialogTitle className="font-headline">Record Supplier's Proposed Changes</ShadDialogTitle>
                <ShadDialogDescription>Modify quantities, prices, costs, or notes based on supplier's proposal. Saving will update the PO to 'Pending Internal Review'.</ShadDialogDescription>
              </DialogHeader>
              <ScrollArea className="flex-grow py-4 pr-2 space-y-4">
                <FormField control={editPOForm.control} name="expectedDeliveryDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>New Expected Delivery Date (Optional)</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button variant={"outline"} className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
                              {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                              <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )} />
                <FormField control={editPOForm.control} name="notes"
                  render={({ field }) => (<FormItem><FormLabel>PO Notes (Updated)</FormLabel><FormControl><Textarea placeholder="Updated notes from supplier or internal remarks" {...field} /></FormControl><FormMessage /></FormItem>)} />
                
                <Card>
                  <CardHeader className="p-3"><CardTitle className="text-md">Product Details (Editable)</CardTitle></CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {editPOForm.getValues('details')?.map((item, index) => (
                      <div key={item.id || `detail-${index}`} className="p-3 border rounded-md space-y-3 bg-muted/30">
                        <h4 className="font-semibold">{editPOForm.getValues(`details.${index}.productName`)}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormField control={editPOForm.control} name={`details.${index}.orderedQuantity`}
                            render={({ field }) => (<FormItem><FormLabel>New Qty*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={editPOForm.control} name={`details.${index}.unitPrice`}
                            render={({ field }) => (<FormItem><FormLabel>New Price*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <FormField control={editPOForm.control} name={`details.${index}.notes`}
                          render={({ field }) => (<FormItem><FormLabel>Item Notes</FormLabel><FormControl><Textarea placeholder="Notes specific to this item's changes" {...field} rows={2} /></FormControl><FormMessage /></FormItem>)} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="p-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-md">Additional Costs (Editable)</CardTitle>
                    <Button type="button" variant="outline" size="sm" onClick={() => appendAdditionalCost({ description: "", amount: 0, type: "other" })}>
                      <Icons.Add className="mr-2 h-4 w-4"/> Add Cost
                    </Button>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {additionalCostFields.map((item, index) => (
                      <div key={item.id} className="p-3 border rounded-md space-y-2 bg-muted/30 relative">
                        <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => removeAdditionalCost(index)}><Icons.Delete className="h-4 w-4 text-destructive"/></Button>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                           <FormField control={editPOForm.control} name={`additionalCosts.${index}.description`}
                            render={({ field }) => (<FormItem><FormLabel>Desc*</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                           <FormField control={editPOForm.control} name={`additionalCosts.${index}.amount`}
                            render={({ field }) => (<FormItem><FormLabel>Amount*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                           <FormField control={editPOForm.control} name={`additionalCosts.${index}.type`}
                            render={({ field }) => (<FormItem><FormLabel>Type*</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                                <SelectContent>{QUOTATION_ADDITIONAL_COST_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}</SelectContent>
                              </Select><FormMessage /></FormItem>)}/>
                        </div>
                      </div>
                    ))}
                    {additionalCostFields.length === 0 && <p className="text-sm text-muted-foreground">No additional costs.</p>}
                  </CardContent>
                </Card>
                {editPOForm.formState.errors.root && <p className="text-destructive text-sm p-1">{editPOForm.formState.errors.root.message}</p>}
              </ScrollArea>
              <DialogFooter className="pt-4 flex-shrink-0 border-t">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingEditPO}>
                  {isSubmittingEditPO ? <Icons.Logo className="animate-spin"/> : "Save Proposal & Review"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        <DialogContent className="sm:max-w-3xl md:max-w-4xl flex flex-col max-h-[90vh]">
          <Form {...receiptForm}>
            <form onSubmit={receiptForm.handleSubmit(onReceiptSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <ShadDialogTitle className="font-headline">Record Stock Receipt</ShadDialogTitle>
                <ShadDialogDescription>Record items received against PO: {purchaseOrder?.id.substring(0,8)}...</ShadDialogDescription>
              </DialogHeader>
              <ScrollArea className="flex-grow py-4 pr-2 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={receiptForm.control} name="receiptDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Receipt Date *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )} />
                  <FormField control={receiptForm.control} name="targetWarehouseId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Warehouse *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingWarehouses}>
                          <FormControl><SelectTrigger><SelectValue placeholder={isLoadingWarehouses ? "Loading..." : "Select warehouse"} /></SelectTrigger></FormControl>
                          <SelectContent>{availableWarehouses.map(wh => <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                </div>
                <FormField control={receiptForm.control} name="overallReceiptNotes"
                  render={({ field }) => (<FormItem><FormLabel>Overall Receipt Notes</FormLabel><FormControl><Textarea placeholder="e.g., Delivery condition, driver details" {...field} /></FormControl><FormMessage /></FormItem>)} />
                
                <Card className="mt-4">
                  <CardHeader className="p-3"><CardTitle className="text-md">Items to Process:</CardTitle></CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {receiptItemsFields.map((item, index) => {
                      const trulyOutstandingForThisReceipt = Math.max(0, item.orderedQuantity - (item.alreadyReceivedOkQuantity + item.alreadyReceivedDamagedQuantity + item.alreadyReceivedMissingQuantity));
                      return (
                        <div key={item.id} className="p-3 border rounded-md space-y-3 bg-muted/30">
                          <div className="flex justify-between items-center">
                            <h4 className="font-semibold">{item.productName}</h4>
                            <p className="text-xs text-muted-foreground">
                              Ordered: {item.orderedQuantity} | 
                              Prev. OK: {item.alreadyReceivedOkQuantity} | 
                              Prev. Damaged: {item.alreadyReceivedDamagedQuantity} | 
                              Prev. Missing: {item.alreadyReceivedMissingQuantity} | 
                              <span className="font-bold text-primary"> Outstanding for this receipt: {trulyOutstandingForThisReceipt}</span>
                            </p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <FormField control={receiptForm.control} name={`itemsToProcess.${index}.qtyOkReceivedThisReceipt`}
                              render={({ field }) => (<FormItem><FormLabel>Qty OK Rec'd*</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField control={receiptForm.control} name={`itemsToProcess.${index}.qtyDamagedReceivedThisReceipt`}
                              render={({ field }) => (<FormItem><FormLabel>Qty Damaged Rec'd*</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                            <FormField control={receiptForm.control} name={`itemsToProcess.${index}.qtyMissingReceivedThisReceipt`}
                              render={({ field }) => (<FormItem><FormLabel>Qty Missing this time*</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                          </div>
                          <div className="col-span-full">
                            <FormField control={receiptForm.control} name={`itemsToProcess.${index}.lineItemNotes`}
                              render={({ field }) => (<FormItem><FormLabel>Line Item Notes (Optional)</FormLabel><FormControl><Textarea placeholder="e.g., Box slightly dented but contents OK" {...field} rows={1} /></FormControl><FormMessage /></FormItem>)} />
                          </div>
                        </div>
                      );
                    })}
                    {receiptForm.formState.errors.itemsToProcess && typeof receiptForm.formState.errors.itemsToProcess.message === 'string' && <p className="text-destructive text-sm p-1">{receiptForm.formState.errors.itemsToProcess.message}</p>}
                    {(receiptForm.formState.errors.itemsToProcess as any)?.root?.message && <p className="text-destructive text-sm p-1">{(receiptForm.formState.errors.itemsToProcess as any)?.root?.message}</p>}
                  </CardContent>
                </Card>
              </ScrollArea>
              <DialogFooter className="pt-4 flex-shrink-0 border-t">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingReceipt}>
                  {isSubmittingReceipt ? <Icons.Logo className="animate-spin"/> : "Record Receipt"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isSupplierSolutionDialogOpen} onOpenChange={setIsSupplierSolutionDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <Form {...supplierSolutionForm}>
            <form onSubmit={supplierSolutionForm.handleSubmit(onSupplierSolutionSubmit)}>
              <DialogHeader>
                <ShadDialogTitle className="font-headline">Record Supplier Solution</ShadDialogTitle>
                <ShadDialogDescription>Document the agreed solution for discrepancies in PO: {purchaseOrder?.id.substring(0,8)}...</ShadDialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={supplierSolutionForm.control} name="solutionType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Solution Type *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select solution type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {SUPPLIER_SOLUTION_TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type.replace(/([A-Z])/g, ' $1').trim()}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                <FormField control={supplierSolutionForm.control} name="solutionDetails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Solution Details *</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe the agreed solution, e.g., credit amount, discount terms, new ETA for missing items."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
              </div>
              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingSolution}>
                  {isSubmittingSolution ? <Icons.Logo className="animate-spin"/> : "Save Solution"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

    
