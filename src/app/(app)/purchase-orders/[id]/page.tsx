
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getPurchaseOrderById, updatePurchaseOrderStatus } from "@/services/purchaseOrderService";
import { updateRequisitionStateAfterPOSent } from "@/services/requisitionService";
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderDetail, QuotationAdditionalCost } from "@/types";
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Icons } from "@/components/icons";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { format, isValid } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const purchaseOrderId = params.id as string;
  const { toast } = useToast();
  const { appUser, role, currentUser } = useAuth();

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

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

  const handleMarkAsSent = async () => {
    if (!purchaseOrder || !currentUser || purchaseOrder.status !== "Pending") return;
    setIsUpdating(true);
    try {
      await updatePurchaseOrderStatus(purchaseOrderId, "Sent", currentUser.uid);
      // After PO is marked Sent, update the requisition's purchased quantities
      const requisitionUpdateResult = await updateRequisitionStateAfterPOSent(purchaseOrderId, currentUser.uid);
      if (requisitionUpdateResult.success) {
        toast({ title: "Purchase Order Sent", description: "PO marked as Sent and Requisition updated." });
      } else {
        toast({ title: "PO Sent, Requisition Update Issue", description: requisitionUpdateResult.message || "PO marked as Sent, but there was an issue updating the Requisition.", variant: "default" });
      }
      fetchPOData(); // Refresh PO data
    } catch (error: any) {
      console.error("Error marking PO as Sent:", error);
      toast({ title: "Update Failed", description: error.message || "Could not mark PO as Sent.", variant: "destructive" });
    }
    setIsUpdating(false);
  };

  const handleCancelPO = async () => {
    if (!purchaseOrder || !currentUser || !["Pending", "Sent"].includes(purchaseOrder.status)) return;
    setIsUpdating(true);
    try {
      await updatePurchaseOrderStatus(purchaseOrderId, "Canceled", currentUser.uid);
      // Note: Canceling a PO might require logic to revert purchased quantities on the requisition.
      // This is more complex and can be added later if needed. For now, it just cancels the PO.
      toast({ title: "Purchase Order Canceled", description: "The PO has been canceled." });
      fetchPOData(); // Refresh PO data
    } catch (error: any) {
      console.error("Error canceling PO:", error);
      toast({ title: "Update Failed", description: error.message || "Could not cancel PO.", variant: "destructive" });
    }
    setIsUpdating(false);
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
      case "Sent": return "default";
      case "Partially Received": return "default";
      case "Completed": return "default";
      case "Canceled": return "destructive";
      default: return "secondary";
    }
  };
   const getStatusBadgeClass = (status?: PurchaseOrderStatus) => {
    if (!status) return "";
    switch (status) {
      case "Sent": return "bg-blue-500 hover:bg-blue-600 text-white";
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
  const canMarkSent = canManagePO && purchaseOrder.status === "Pending";
  const canCancel = canManagePO && (purchaseOrder.status === "Pending" || purchaseOrder.status === "Sent");


  return (
    <>
      <PageHeader
        title={`Purchase Order: ${purchaseOrder.id.substring(0,8)}...`}
        description={`Supplier: ${purchaseOrder.supplierName || purchaseOrder.supplierId}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canMarkSent && (
              <Button onClick={handleMarkAsSent} disabled={isUpdating}>
                {isUpdating ? <Icons.Logo className="animate-spin mr-2" /> : <Icons.Send className="mr-2 h-4 w-4" />}
                Mark as Sent
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
                      This action cannot be undone. Canceling the PO will mark it as 'Canceled'.
                      It will not automatically revert received quantities if any.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep PO</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancelPO} className="bg-destructive hover:bg-destructive/90">Confirm Cancellation</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {/* Record Receipt button will be added in a future stage */}
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
    </>
  );
}
    