
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
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderDetail, QuotationAdditionalCost } from "@/types";
import { QUOTATION_ADDITIONAL_COST_TYPES } from "@/types"; // For edit dialog
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


const poDetailItemSchema = z.object({
  id: z.string().optional(), // For existing items in subcollection (though we replace all)
  productId: z.string(),
  productName: z.string(), // Denormalized, read-only in form
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

  const editPOForm = useForm<EditPOFormData>({
    resolver: zodResolver(editPOFormSchema),
  });

  const { fields: editPODetailFields, append: appendEditPODetail, remove: removeEditPODetail } = useFieldArray({
    control: editPOForm.control,
    name: "details",
  });
  const { fields: editPOAdditionalCostFields, append: appendEditPOAdditionalCost, remove: removeEditPOAdditionalCost } = useFieldArray({
    control: editPOForm.control,
    name: "additionalCosts",
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
        id: d.id, // Keep if needed for direct subcollection item updates (not used if deleting all)
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
      details: data.details.map(d => ({ // Ensure structure matches service
        productId: d.productId,
        productName: d.productName,
        orderedQuantity: d.orderedQuantity,
        unitPrice: d.unitPrice,
        notes: d.notes || "",
      })),
    };

    try {
      await updatePurchaseOrderDetailsAndCosts(purchaseOrderId, payload);
      // After successful data update, trigger status change to ConfirmedBySupplier
      await handleStatusChange("ConfirmedBySupplier"); // This will also trigger requisition updates
      toast({ title: "PO Updated & Confirmed", description: "Purchase Order details updated and confirmed with supplier." });
      setIsEditPODialogOpen(false);
      fetchPOData(); // Re-fetch to show latest data and status
    } catch (error: any) {
      console.error("Error updating PO with supplier changes:", error);
      toast({ title: "Update Failed", description: error.message || "Could not update Purchase Order.", variant: "destructive" });
    }
    setIsSubmittingEditPO(false);
  };


  const formatTimestampDate = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    let date: Date;
    if (timestamp instanceof Timestamp) {
      date = timestamp.toDate();
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return "Invalid Date";
    }
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
      case "Partially Received": return "default";
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
      case "Partially Received": return "bg-yellow-400 hover:bg-yellow-500 text-black";
      case "Completed": return "bg-green-500 hover:bg-green-600 text-white";
      default: return "";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Purchase Order Details" description="Loading PO information..." />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!purchaseOrder) {
    return (
      <div className="space-y-4">
        <PageHeader title="Purchase Order Not Found" description="The requested PO could not be loaded." />
        <Button onClick={() => router.push("/purchase-orders")} variant="outline">Back to List</Button>
      </div>
    );
  }

  const canManagePO = role === 'admin' || role === 'superadmin';
  const isPending = purchaseOrder.status === "Pending";
  const isSentToSupplier = purchaseOrder.status === "SentToSupplier";
  const isChangesProposed = purchaseOrder.status === "ChangesProposedBySupplier";
  const isConfirmedBySupplier = purchaseOrder.status === "ConfirmedBySupplier";
  const isPartiallyReceived = purchaseOrder.status === "Partially Received";

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
            {canSendToSupplier && (
              <Button onClick={() => handleStatusChange("SentToSupplier")} disabled={isUpdating}>
                {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Send className="mr-2 h-4 w-4" />}
                Send to Supplier
              </Button>
            )}
            {canRecordSupplierInitialResponse && (
              <>
                <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="default" className="bg-teal-500 hover:bg-teal-600">
                  {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}
                  Confirm PO (as is)
                </Button>
                <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">
                  {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}
                  Record Supplier Rejection
                </Button>
                <Button onClick={() => handleStatusChange("ChangesProposedBySupplier")} disabled={isUpdating} variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
                  {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Edit className="mr-2 h-4 w-4" />}
                  Log Supplier Changes
                </Button>
              </>
            )}
            {canActOnProposedChanges && (
                <>
                    <Button onClick={handleOpenEditPODialog} disabled={isUpdating || isSubmittingEditPO} variant="default" className="bg-blue-500 hover:bg-blue-600">
                      <Icons.Edit className="mr-2 h-4 w-4" />
                      Edit PO & Confirm
                    </Button>
                    <Button onClick={() => handleStatusChange("ConfirmedBySupplier")} disabled={isUpdating} variant="outline" className="border-teal-500 text-teal-600 hover:bg-teal-50">
                        {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}
                        Confirm Original PO
                    </Button>
                    <Button onClick={() => handleStatusChange("RejectedBySupplier")} disabled={isUpdating} variant="destructive">
                        {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.X className="mr-2 h-4 w-4" />}
                        Reject PO
                    </Button>
                </>
            )}
            {canRecordReceipt && (
              <Button onClick={() => toast({ title: "Feature Coming Soon", description: "Detailed stock receipt registration will be available soon."})} disabled={isUpdating} variant="outline">
                <Icons.Package className="mr-2 h-4 w-4" /> Record Receipt
              </Button>
            )}
             {canMarkCompleted && (
                <Button
                    onClick={() => handleStatusChange("Completed")}
                    disabled={isUpdating}
                    variant="default"
                    className="bg-green-500 hover:bg-green-600 text-white"
                >
                    {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Check className="mr-2 h-4 w-4" />}
                    Mark as Fully Received/Completed
                </Button>
            )}
            {canCancel && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                   <Button variant="destructive" disabled={isUpdating}>
                    {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Delete className="mr-2 h-4 w-4" />}
                    Cancel PO
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure you want to cancel this Purchase Order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action will mark the PO as 'Canceled'.
                      If canceled before 'ConfirmedBySupplier', pending quantities on the requisition will be adjusted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep PO</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleStatusChange("Canceled")} className="bg-destructive hover:bg-destructive/90">Confirm Cancellation</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button onClick={() => router.back()} variant="outline">Back</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">PO Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">PO ID:</span><span className="font-medium truncate max-w-[150px]">{purchaseOrder.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Origin Requisition:</span>
              <Link href={`/requisitions/${purchaseOrder.originRequisitionId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">
                {purchaseOrder.originRequisitionId.substring(0,8)}...
              </Link>
            </div>
            {purchaseOrder.quotationReferenceId && (
              <div className="flex justify-between"><span className="text-muted-foreground">Quotation Ref:</span>
                <Link href={`/quotations/${purchaseOrder.quotationReferenceId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">
                  {purchaseOrder.quotationReferenceId.substring(0,8)}...
                </Link>
              </div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier:</span><span className="font-medium">{purchaseOrder.supplierName || "N/A"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Order Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.orderDate)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Expected Delivery:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.expectedDeliveryDate)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(purchaseOrder.status)} className={getStatusBadgeClass(purchaseOrder.status)}>
                {purchaseOrder.status}
              </Badge>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{purchaseOrder.creationUserName || purchaseOrder.creationUserId}</span></div>
            {purchaseOrder.completionDate && (<div className="flex justify-between"><span className="text-muted-foreground">Completion Date:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.completionDate)}</span></div>)}

            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Products Subtotal:</span><span className="font-medium">${Number(purchaseOrder.productsSubtotal || 0).toFixed(2)}</span></div>
            {purchaseOrder.additionalCosts && purchaseOrder.additionalCosts.length > 0 && (
                <>
                 <span className="text-muted-foreground">Additional Costs:</span>
                    <ul className="list-disc pl-5 text-xs">
                    {purchaseOrder.additionalCosts.map((cost, index) => (
                        <li key={index} className="flex justify-between">
                        <span>{cost.description} ({cost.type})</span>
                        <span className="font-medium">${Number(cost.amount).toFixed(2)}</span>
                        </li>
                    ))}
                    </ul>
                </>
            )}
            <div className="flex justify-between text-md font-semibold pt-1"><span className="text-muted-foreground">Total PO Amount:</span><span>${Number(purchaseOrder.totalAmount || 0).toFixed(2)}</span></div>
            <Separator />
            <div><span className="text-muted-foreground">Notes:</span><p className="font-medium whitespace-pre-wrap">{purchaseOrder.notes || "N/A"}</p></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{formatTimestampDate(purchaseOrder.updatedAt)}</span></div>

          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Ordered Products</CardTitle>
            <CardDescription>List of products included in this purchase order.</CardDescription>
          </CardHeader>
          <CardContent>
            {purchaseOrder.details && purchaseOrder.details.length > 0 ? (
              <ScrollArea className="h-[calc(100vh-22rem)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Ordered Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">Received Qty</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchaseOrder.details.map((item) => (
                      <TableRow key={item.id || item.productId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.orderedQuantity}</TableCell>
                        <TableCell className="text-right">${Number(item.unitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">${(Number(item.orderedQuantity) * Number(item.unitPrice)).toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.receivedQuantity}</TableCell>
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

      {/* Edit PO Dialog */}
      <Dialog open={isEditPODialogOpen} onOpenChange={setIsEditPODialogOpen}>
        <DialogContent className="sm:max-w-3xl flex flex-col max-h-[90vh]">
          <Form {...editPOForm}>
            <form onSubmit={editPOForm.handleSubmit(handleEditPOSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <ShadDialogTitle className="font-headline">Edit Purchase Order Details (Supplier Feedback)</ShadDialogTitle>
                <DialogDescription>
                  Modify quantities, prices, costs, or notes based on supplier's proposed changes.
                  Saving will confirm the PO with these new details.
                </DialogDescription>
              </DialogHeader>
              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <FormField
                  control={editPOForm.control}
                  name="expectedDeliveryDate"
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
                  )}
                />
                <FormField
                  control={editPOForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PO Notes (Updated)</FormLabel>
                      <FormControl><Textarea {...field} placeholder="Enter updated notes for the PO" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Card>
                  <CardHeader className="p-2"><CardTitle className="text-md">Product Details (Editable)</CardTitle></CardHeader>
                  <CardContent className="p-2 space-y-3">
                    {editPODetailFields.map((item, index) => (
                      <div key={item.id} className="p-3 border rounded-md space-y-2 bg-muted/30">
                        <h4 className="font-semibold text-sm">{editPOForm.getValues(`details.${index}.productName`)}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormField
                            control={editPOForm.control}
                            name={`details.${index}.orderedQuantity`}
                            render={({ field }) => (<FormItem><FormLabel className="text-xs">New Qty*</FormLabel><FormControl><Input type="number" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)}
                          />
                          <FormField
                            control={editPOForm.control}
                            name={`details.${index}.unitPrice`}
                            render={({ field }) => (<FormItem><FormLabel className="text-xs">New Price*</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)}
                          />
                        </div>
                        <FormField
                          control={editPOForm.control}
                          name={`details.${index}.notes`}
                          render={({ field }) => (<FormItem><FormLabel className="text-xs">Item Notes</FormLabel><FormControl><Textarea {...field} rows={1} className="text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="p-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-md">Additional Costs (Editable)</CardTitle>
                    <Button type="button" variant="outline" size="sm" onClick={() => appendEditPOAdditionalCost({ description: "", amount: 0, type: "other" })}>
                      <Icons.Add className="mr-1 h-3 w-3" /> Add Cost
                    </Button>
                  </CardHeader>
                  <CardContent className="p-2 space-y-2">
                    {editPOAdditionalCostFields.map((item, index) => (
                      <div key={item.id} className="p-2 border rounded-md space-y-2 bg-muted/30 relative">
                        <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-5 w-5" onClick={() => removeEditPOAdditionalCost(index)}><Icons.Delete className="h-3 w-3 text-destructive" /></Button>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                          <FormField control={editPOForm.control} name={`additionalCosts.${index}.description`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Desc*</FormLabel><FormControl><Input {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} />
                          <FormField control={editPOForm.control} name={`additionalCosts.${index}.amount`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Amount*</FormLabel><FormControl><Input type="number" step="0.01" {...field} className="h-8 text-sm" /></FormControl><FormMessage className="text-xs" /></FormItem>)} />
                          <FormField control={editPOForm.control} name={`additionalCosts.${index}.type`} render={({ field }) => (<FormItem><FormLabel className="text-xs">Type*</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Type" /></SelectTrigger></FormControl><SelectContent>{QUOTATION_ADDITIONAL_COST_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select><FormMessage className="text-xs" /></FormItem>)} />
                        </div>
                      </div>
                    ))}
                    {editPOAdditionalCostFields.length === 0 && <p className="text-xs text-muted-foreground p-2">No additional costs.</p>}
                  </CardContent>
                </Card>
                 {editPOForm.formState.errors.root && <p className="text-sm font-medium text-destructive">{editPOForm.formState.errors.root.message}</p>}
              </div>
              <DialogFooter className="pt-4 flex-shrink-0 border-t">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingEditPO}>
                  {isSubmittingEditPO ? <Icons.Logo className="animate-spin" /> : "Save Changes & Confirm PO"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </>
  );
}
