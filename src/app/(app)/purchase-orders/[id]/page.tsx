
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getPurchaseOrderById, updatePurchaseOrderStatus, updatePurchaseOrderDetailsAndCosts, type UpdatePOWithChangesData } from "@/services/purchaseOrderService";
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderDetail, QuotationAdditionalCost, Warehouse as AppWarehouse, User as AppUser } from "@/types";
import { QUOTATION_ADDITIONAL_COST_TYPES, PURCHASE_ORDER_STATUSES, RECEIPT_ITEM_STATUSES } from "@/types"; 
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icons } from "@/components/icons";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { format, isValid, parseISO } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle as ShadDialogTitle, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { getActiveWarehouses } from "@/services/warehouseService";
import { createReceipt, updatePOStatusAfterReceipt, type CreateReceiptServiceData } from "@/services/receiptService";


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
  alreadyReceivedQuantity: z.number(),
  outstandingQuantity: z.number(),
  quantityReceivedThisTime: z.coerce.number()
    .min(0, "Quantity received must be non-negative.")
    .refine((val, ctx) => {
        // Access sibling outstandingQuantity for max validation
        // This requires passing the full item data to the refinement or getting it from context
        // For simplicity, we'll assume a way to access `outstandingQuantity` or validate it at a higher level.
        // A common pattern is to refine the parent array.
        return true; // Placeholder, refinement at array level
    }, "Cannot receive more than outstanding."),
  itemStatus: z.enum(RECEIPT_ITEM_STATUSES),
  itemNotes: z.string().optional(),
});

const recordReceiptFormSchema = z.object({
  receiptDate: z.date({ required_error: "Receipt date is required." }),
  targetWarehouseId: z.string().min(1, "Target warehouse is required."),
  notes: z.string().optional(),
  itemsToReceive: z.array(recordReceiptItemSchema)
    .min(1, "At least one item must be specified for receipt.")
    .superRefine((items, ctx) => {
        let totalReceivedThisTime = 0;
        items.forEach((item, index) => {
            if (item.quantityReceivedThisTime > item.outstandingQuantity) {
                ctx.addIssue({
                    path: [`itemsToReceive`, index, "quantityReceivedThisTime"],
                    message: `Cannot receive ${item.quantityReceivedThisTime}. Max outstanding is ${item.outstandingQuantity}.`,
                });
            }
            if (item.quantityReceivedThisTime > 0 && item.itemStatus === "Missing") {
                 ctx.addIssue({
                    path: [`itemsToReceive`, index, "itemStatus"],
                    message: `Cannot mark as 'Missing' if quantity > 0 is received. Use 'Ok', 'Damaged', or 'Other'.`,
                });
            }
            totalReceivedThisTime += item.quantityReceivedThisTime;
        });
        if (totalReceivedThisTime <= 0) {
            ctx.addIssue({
                path: ["itemsToReceive"], // General error for the array
                message: "At least one item must have a received quantity greater than zero.",
            });
        }
    }),
});

type RecordReceiptFormData = z.infer<typeof recordReceiptFormSchema>;


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

  const editPOForm = useForm<EditPOFormData>({
    resolver: zodResolver(editPOFormSchema),
  });
  const { fields: editPODetailFields, append: appendEditPODetail, remove: removeEditPODetail } = useFieldArray({
    control: editPOForm.control, name: "details",
  });
  const { fields: editPOAdditionalCostFields, append: appendEditPOAdditionalCost, remove: removeEditPOAdditionalCost } = useFieldArray({
    control: editPOForm.control, name: "additionalCosts",
  });

  const receiptForm = useForm<RecordReceiptFormData>({
    resolver: zodResolver(recordReceiptFormSchema),
    defaultValues: {
      receiptDate: new Date(),
      itemsToReceive: [],
    }
  });
  const { fields: receiptItemsFields, replace: replaceReceiptItems } = useFieldArray({
    control: receiptForm.control, name: "itemsToReceive"
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
    editPOForm.reset({
      notes: purchaseOrder.notes || "",
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate?.toDate(),
      additionalCosts: purchaseOrder.additionalCosts?.map(ac => ({...ac, amount: Number(ac.amount)})) || [],
      details: purchaseOrder.details?.map(d => ({
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
      additionalCosts: data.additionalCosts || [],
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
      await handleStatusChange("ConfirmedBySupplier");
      toast({ title: "PO Updated & Confirmed", description: "Purchase Order details updated and confirmed with supplier." });
      setIsEditPODialogOpen(false);
      fetchPOData();
    } catch (error: any) {
      console.error("Error updating PO with supplier changes:", error);
      toast({ title: "Update Failed", description: error.message || "Could not update Purchase Order.", variant: "destructive" });
    }
    setIsSubmittingEditPO(false);
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

        const itemsForReceipt = purchaseOrder.details
            .filter(d => d.orderedQuantity > (d.receivedQuantity || 0))
            .map(d => ({
                productId: d.productId,
                productName: d.productName,
                poDetailId: d.id,
                orderedQuantity: d.orderedQuantity,
                alreadyReceivedQuantity: d.receivedQuantity || 0,
                outstandingQuantity: d.orderedQuantity - (d.receivedQuantity || 0),
                quantityReceivedThisTime: 0, // Default to 0 for input
                itemStatus: "Ok" as const,
                itemNotes: "",
            }));

        if (itemsForReceipt.length === 0) {
            toast({ title: "No Items to Receive", description: "All items on this PO have been fully received.", variant: "default" });
            return;
        }
        
        receiptForm.reset({
            receiptDate: new Date(),
            targetWarehouseId: activeWarehouses.find(wh => wh.isDefault)?.id || (activeWarehouses.length > 0 ? activeWarehouses[0].id : ""),
            notes: "",
            itemsToReceive: itemsForReceipt,
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

    const itemsActuallyReceived = data.itemsToReceive.filter(item => item.quantityReceivedThisTime > 0);
    if (itemsActuallyReceived.length === 0) {
        receiptForm.setError("itemsToReceive", { type: "manual", message: "You must enter a received quantity for at least one item." });
        setIsSubmittingReceipt(false);
        return;
    }

    const payload: CreateReceiptServiceData = {
        purchaseOrderId: purchaseOrder.id,
        receiptDate: Timestamp.fromDate(data.receiptDate),
        receivingUserId: currentUser.uid,
        targetWarehouseId: data.targetWarehouseId,
        notes: data.notes || "",
        itemsToReceive: itemsActuallyReceived.map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantityReceived: item.quantityReceivedThisTime,
            itemStatus: item.itemStatus,
            itemNotes: item.itemNotes || "",
            poDetailId: item.poDetailId,
            currentPOReceivedQuantity: item.alreadyReceivedQuantity,
            poOrderedQuantity: item.orderedQuantity,
        })),
    };

    try {
        await createReceipt(payload);
        await updatePOStatusAfterReceipt(purchaseOrder.id); // Service to re-evaluate PO status
        toast({ title: "Receipt Recorded", description: "Stock receipt successfully recorded." });
        setIsReceiptDialogOpen(false);
        fetchPOData(); // Refresh PO data
    } catch (error: any) {
        console.error("Error recording receipt:", error);
        toast({ title: "Receipt Failed", description: error.message || "Could not record receipt.", variant: "destructive" });
    }
    setIsSubmittingReceipt(false);
  };


  const formatTimestampDate = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    let date: Date;
    if (timestamp instanceof Timestamp) date = timestamp.toDate();
    else if (typeof timestamp === 'string') date = parseISO(timestamp); // Handles ISO strings if any
    else return "Invalid Date Object";
    return isValid(date) ? format(date, "PPP") : "Invalid Date";
  };

  const getStatusBadgeVariant = (status?: PurchaseOrderStatus) => {
    if (!status) return "secondary";
    switch (status) {
      case "Pending": return "outline";
      case "SentToSupplier": return "default";
      case "ChangesProposedBySupplier": return "default";
      case "ConfirmedBySupplier": return "default";
      case "RejectedBySupplier": return "destructive";
      case "PartiallyReceived": return "default";
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
      case "ConfirmedBySupplier": return "bg-teal-500 hover:bg-teal-600 text-white";
      case "PartiallyReceived": return "bg-yellow-400 hover:bg-yellow-500 text-black";
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
  const isPending = purchaseOrder.status === "Pending";
  const isSentToSupplier = purchaseOrder.status === "SentToSupplier";
  const isChangesProposed = purchaseOrder.status === "ChangesProposedBySupplier";
  const isConfirmedBySupplier = purchaseOrder.status === "ConfirmedBySupplier";
  const isPartiallyReceived = purchaseOrder.status === "PartiallyReceived";

  const canSendToSupplier = canManagePO && isPending;
  const canRecordSupplierInitialResponse = canManagePO && isSentToSupplier;
  const canActOnProposedChanges = canManagePO && isChangesProposed;
  const canCancel = canManagePO && ["Pending", "SentToSupplier", "ChangesProposedBySupplier", "ConfirmedBySupplier"].includes(purchaseOrder.status);
  const canRecordReceipt = canManagePO && (isConfirmedBySupplier || isPartiallyReceived);
  const canMarkCompleted = canManagePO && (isConfirmedBySupplier || isPartiallyReceived);

  return (
    <>
      <PageHeader
        title={`Purchase Order: ${purchaseOrder.id.substring(0,8)}...`}
        description={`Supplier: ${purchaseOrder.supplierName || purchaseOrder.supplierId}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canSendToSupplier && (<Button onClick={() => handleStatusChange("SentToSupplier")} disabled={isUpdating}>{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Send className="mr-2 h-4 w-4" />}Send to Supplier</Button>)}
            {canRecordSupplierInitialResponse && (
              <>
                <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="default" className="bg-teal-500 hover:bg-teal-600">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}Record Supplier Confirmation</Button>
                <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}Record Supplier Rejection</Button>
                <Button onClick={() => handleStatusChange("ChangesProposedBySupplier")} disabled={isUpdating} variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Edit className="mr-2 h-4 w-4" />}Log Supplier Changes</Button>
              </>
            )}
            {canActOnProposedChanges && (
                <>
                    <Button onClick={handleOpenEditPODialog} disabled={isUpdating || isSubmittingEditPO} variant="default" className="bg-blue-500 hover:bg-blue-600"><Icons.Edit className="mr-2 h-4 w-4" />Edit PO & Confirm</Button>
                    <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="outline" className="border-teal-500 text-teal-600 hover:bg-teal-50">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}Confirm Original PO</Button>
                    <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}Reject PO</Button>
                </>
            )}
            {canRecordReceipt && (<Button onClick={handleOpenReceiptDialog} disabled={isUpdating || isLoadingWarehouses} variant="default"><Icons.Package className="mr-2 h-4 w-4" /> Record Receipt</Button>)}
            {canMarkCompleted && (<Button onClick={() => handleStatusChange("Completed")} disabled={isUpdating} variant="default" className="bg-green-500 hover:bg-green-600 text-white">{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}Mark as Fully Received/Completed</Button>)}
            {canCancel && (<AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={isUpdating}>{isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Delete className="mr-2 h-4 w-4" />}Cancel PO</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Are you sure you want to cancel this Purchase Order?</AlertDialogTitle><AlertDialogDescription>This action will mark the PO as 'Canceled'. If canceled before supplier confirmation, pending quantities on the requisition will be adjusted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep PO</AlertDialogCancel><AlertDialogAction onClick={() => handleStatusChange("Canceled")} className="bg-destructive hover:bg-destructive/90">Confirm Cancellation</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>)}
            <Button onClick={() => router.back()} variant="outline">Back</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1"><CardHeader><CardTitle className="font-headline">PO Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">PO ID:</span><span className="font-medium truncate max-w-[150px]">{purchaseOrder.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Origin Requisition:</span><Link href={`/requisitions/${purchaseOrder.originRequisitionId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">{purchaseOrder.originRequisitionId.substring(0,8)}...</Link></div>
            {purchaseOrder.quotationReferenceId && (<div className="flex justify-between"><span className="text-muted-foreground">Quotation Ref:</span><Link href={`/quotations/${purchaseOrder.quotationReferenceId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">{purchaseOrder.quotationReferenceId.substring(0,8)}...</Link></div>)}
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier:</span><span className="font-medium">{purchaseOrder.supplierName || "N/A"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Order Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.orderDate)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Expected Delivery:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.expectedDeliveryDate)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span><Badge variant={getStatusBadgeVariant(purchaseOrder.status)} className={getStatusBadgeClass(purchaseOrder.status)}>{purchaseOrder.status}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{purchaseOrder.creationUserName || purchaseOrder.creationUserId}</span></div>
            {purchaseOrder.completionDate && (<div className="flex justify-between"><span className="text-muted-foreground">Completion Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.completionDate)}</span></div>)}
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Products Subtotal:</span><span className="font-medium">${Number(purchaseOrder.productsSubtotal || 0).toFixed(2)}</span></div>
            {purchaseOrder.additionalCosts && purchaseOrder.additionalCosts.length > 0 && (<><span className="text-muted-foreground">Additional Costs:</span><ul className="list-disc pl-5 text-xs">{purchaseOrder.additionalCosts.map((cost, index) => (<li key={index} className="flex justify-between"><span>{cost.description} ({cost.type})</span><span className="font-medium">${Number(cost.amount).toFixed(2)}</span></li>))}</ul></>)}
            <div className="flex justify-between text-md font-semibold pt-1"><span className="text-muted-foreground">Total PO Amount:</span><span>${Number(purchaseOrder.totalAmount || 0).toFixed(2)}</span></div>
            <Separator />
            <div><span className="text-muted-foreground">Notes:</span><p className="font-medium whitespace-pre-wrap">{purchaseOrder.notes || "N/A"}</p></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.updatedAt)}</span></div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2"><CardHeader><CardTitle className="font-headline">Ordered Products</CardTitle><CardDescription>List of products included in this purchase order.</CardDescription></CardHeader>
          <CardContent>
            {purchaseOrder.details && purchaseOrder.details.length > 0 ? (<ScrollArea className="h-[calc(100vh-22rem)]"><Table><TableHeader><TableRow><TableHead>Product Name</TableHead><TableHead className="text-right">Ordered Qty</TableHead><TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">Received Qty</TableHead><TableHead>Item Notes</TableHead></TableRow></TableHeader><TableBody>{purchaseOrder.details.map((item) => (<TableRow key={item.id || item.productId}><TableCell className="font-medium">{item.productName}</TableCell><TableCell className="text-right">{item.orderedQuantity}</TableCell><TableCell className="text-right">${Number(item.unitPrice).toFixed(2)}</TableCell><TableCell className="text-right font-semibold">${(Number(item.orderedQuantity) * Number(item.unitPrice)).toFixed(2)}</TableCell><TableCell className="text-right">{item.receivedQuantity || 0}</TableCell><TableCell className="whitespace-pre-wrap text-xs max-w-[150px] truncate" title={item.notes}>{item.notes || "N/A"}</TableCell></TableRow>))}</TableBody></Table></ScrollArea>) : (<p>No products listed for this purchase order.</p>)}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isEditPODialogOpen} onOpenChange={setIsEditPODialogOpen}>
        <DialogContent className="sm:max-w-3xl flex flex-col max-h-[90vh]"><Form {...editPOForm}><form onSubmit={editPOForm.handleSubmit(handleEditPOSubmit)} className="flex flex-col flex-grow min-h-0"><DialogHeader><ShadDialogTitle className="font-headline">Edit Purchase Order Details (Supplier Feedback)</ShadDialogTitle><DialogDescription>Modify quantities, prices, costs, or notes based on supplier's proposed changes. Saving will confirm the PO with these new details.</DialogDescription></DialogHeader><div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4"><FormField control={editPOForm.control} name="expectedDeliveryDate" render={({ field }) => (<FormItem className="flex flex-col"><FormLabel>New Expected Delivery Date (Optional)</FormLabel><Popover><PopoverTrigger asChild><FormControl><Button variant={"outline"} className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<Icons.Calendar className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent></Popover><FormMessage /></FormItem>)} /><FormField control={editPOForm.control} name="notes" render={({ field }) => (<FormItem><FormLabel>PO Notes (Updated)</FormLabel><FormControl><Textarea {...field} placeholder="Enter updated notes for the PO" /></FormControl><FormMessage /></FormItem>)} /><Card><CardHeader className="p-2"><CardTitle className="text-md">Product Details (Editable)</CardTitle></CardHeader><CardContent className="p-2 space-y-3">{editPODetailFields.map((item, index) => (<div key={item.id} className="p-3 border rounded-md space-y-2 bg-muted/30"><h4 className="font-semibold text-sm">{editPOForm.getValues(`details.${index}.productName`)}</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><FormField control={editPOForm.control} name={`details.${index}.orderedQuantity`} render={({ field }) => (<FormItem><FormLabel className="text-xs">New Qty*</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} /><FormField control={editPOForm.control} name={`details.${index}.unitPrice`} render={({ field }) => (<FormItem><FormLabel className="text-xs">New Price*</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} /></div><FormField control={editPOForm.control} name={`details.${index}.notes`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Item Notes</FormLabel><FormControl><Textarea {...field} rows={1} className="text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} /></div>))}</CardContent></Card><Card><CardHeader className="p-2 flex flex-row items-center justify-between"><CardTitle className="text-md">Additional Costs (Editable)</CardTitle><Button type="button" variant="outline" size="sm" onClick={() => appendEditPOAdditionalCost({ description: "", amount: 0, type: "other" })}><Icons.Add className="mr-1 h-3 w-3" /> Add Cost</Button></CardHeader><CardContent className="p-2 space-y-2">{editPOAdditionalCostFields.map((item, index) => (<div key={item.id} className="p-2 border rounded-md space-y-2 bg-muted/30 relative"><Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-5 w-5" onClick={() => removeEditPOAdditionalCost(index)}><Icons.Delete className="h-3 w-3 text-destructive" /></Button><div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end"><FormField control={editPOForm.control} name={`additionalCosts.${index}.description`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Desc*</FormLabel><FormControl><Input {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} /><FormField control={editPOForm.control} name={`additionalCosts.${index}.amount`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Amount*</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} /><FormField control={editPOForm.control} name={`additionalCosts.${index}.type`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Type*</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Type" /></SelectTrigger></FormControl><SelectContent>{QUOTATION_ADDITIONAL_COST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select><FormMessage className="text-xs" /></FormItem>)} /></div></div>))}{editPOAdditionalCostFields.length === 0 && <p className="text-xs text-muted-foreground p-2">No additional costs.</p>}</CardContent></Card>{editPOForm.formState.errors.root && <p className="text-sm font-medium text-destructive">{editPOForm.formState.errors.root.message}</p>}</div><DialogFooter className="pt-4 flex-shrink-0 border-t"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={isSubmittingEditPO}>{isSubmittingEditPO ? <Icons.Logo className="animate-spin" /> : "Save Changes & Confirm PO"}</Button></DialogFooter></form></Form></DialogContent>
      </Dialog>

      <Dialog open={isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
        <DialogContent className="sm:max-w-3xl md:max-w-4xl flex flex-col max-h-[90vh]">
          <Form {...receiptForm}>
            <form onSubmit={receiptForm.handleSubmit(onReceiptSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <ShadDialogTitle className="font-headline text-xl">Record Stock Receipt</ShadDialogTitle>
                <DialogDescription>Record items received against PO: {purchaseOrder?.id.substring(0,8)}...</DialogDescription>
              </DialogHeader>
              <ScrollArea className="flex-grow py-4 pr-2 min-h-0">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={receiptForm.control} name="receiptDate" render={({ field }) => (
                        <FormItem className="flex flex-col"><FormLabel>Receipt Date *</FormLabel>
                          <Popover><PopoverTrigger asChild><FormControl>
                                <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal",!field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : (<span>Pick a date</span>)}<Icons.Calendar className="ml-auto h-4 w-4 opacity-50" /></Button>
                              </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus /></PopoverContent>
                          </Popover><FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={receiptForm.control} name="targetWarehouseId" render={({ field }) => (
                        <FormItem><FormLabel>Target Warehouse *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingWarehouses}>
                            <FormControl><SelectTrigger><SelectValue placeholder={isLoadingWarehouses ? "Loading..." : "Select warehouse"} /></SelectTrigger></FormControl>
                            <SelectContent>{availableWarehouses.map(wh => (<SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>))}</SelectContent>
                          </Select><FormMessage />
                        </FormItem>
                    )} />
                  </div>
                  <FormField control={receiptForm.control} name="notes" render={({ field }) => (<FormItem><FormLabel>Overall Receipt Notes</FormLabel><FormControl><Textarea placeholder="e.g., Delivery condition, driver info" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  
                  <Separator />
                  <h3 className="text-md font-semibold">Items to Receive:</h3>
                  {receiptItemsFields.map((item, index) => {
                    const outstandingQty = item.orderedQuantity - item.alreadyReceivedQuantity;
                    return (
                      <Card key={item.id} className="p-3 bg-muted/30">
                        <CardTitle className="text-base mb-2">{item.productName}</CardTitle>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                          <div><FormLabel className="text-xs">Ordered</FormLabel><Input type="text" value={item.orderedQuantity} readOnly disabled className="h-8 text-sm bg-muted/50" /></div>
                          <div><FormLabel className="text-xs">Already Received</FormLabel><Input type="text" value={item.alreadyReceivedQuantity} readOnly disabled className="h-8 text-sm bg-muted/50" /></div>
                          <div><FormLabel className="text-xs">Outstanding</FormLabel><Input type="text" value={outstandingQty} readOnly disabled className="h-8 text-sm bg-muted/50 font-semibold" /></div>
                        </div>
                        <Separator className="my-3" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormField control={receiptForm.control} name={`itemsToReceive.${index}.quantityReceivedThisTime`} render={({ field }) => (
                              <FormItem><FormLabel className="text-xs">Quantity Received Now *</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-sm" min={0} max={outstandingQty} /></FormControl><FormMessage className="text-xs" /></FormItem>
                          )} />
                          <FormField control={receiptForm.control} name={`itemsToReceive.${index}.itemStatus`} render={({ field }) => (
                            <FormItem><FormLabel className="text-xs">Item Status *</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Status" /></SelectTrigger></FormControl>
                                <SelectContent>{RECEIPT_ITEM_STATUSES.map(s => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
                              </Select><FormMessage className="text-xs" />
                            </FormItem>
                          )} />
                        </div>
                         <FormField control={receiptForm.control} name={`itemsToReceive.${index}.itemNotes`} render={({ field }) => (
                              <FormItem className="mt-2"><FormLabel className="text-xs">Item Notes</FormLabel><FormControl><Textarea rows={1} {...field} className="text-sm" placeholder="e.g., Batch number, expiry, specific defect if damaged" /></FormControl><FormMessage className="text-xs" /></FormItem>
                          )} />
                      </Card>
                    );
                  })}
                  {receiptForm.formState.errors.itemsToReceive && typeof receiptForm.formState.errors.itemsToReceive.message === 'string' && (<p className="text-sm font-medium text-destructive">{receiptForm.formState.errors.itemsToReceive.message}</p>)}
                  {(receiptForm.formState.errors.itemsToReceive as any)?.root?.message && (<p className="text-sm font-medium text-destructive">{(receiptForm.formState.errors.itemsToReceive as any)?.root?.message}</p>)}
                </div>
              </ScrollArea>
              <DialogFooter className="pt-4 flex-shrink-0 border-t mt-auto">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingReceipt || isLoadingWarehouses}>
                  {isSubmittingReceipt ? <Icons.Logo className="animate-spin" /> : "Record Receipt"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
