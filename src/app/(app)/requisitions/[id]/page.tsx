
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getRequisitionById, updateRequisitionStatus, updateRequisition, type UpdateRequisitionData } from "@/services/requisitionService";
import type { Requisition, RequisitionStatus, RequiredProduct, Supplier, ProveedorProducto, PriceRange } from "@/types";
import { REQUISITION_STATUSES } from "@/types";
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icons } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAllSuppliers } from "@/services/supplierService";
import { createQuotation, type CreateQuotationRequestData } from "@/services/quotationService";
import { getSupplierProduct } from "@/services/supplierProductService";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";


const quotationRequestFormSchema = z.object({
  supplierIds: z.array(z.string()).min(1, "At least one supplier must be selected."),
  responseDeadline: z.date({ required_error: "Response deadline is required." }),
  notes: z.string().optional(),
});
type QuotationRequestFormData = z.infer<typeof quotationRequestFormSchema>;


export default function RequisitionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requisitionId = params.id as string;
  const { toast } = useToast();
  const { appUser, role, currentUser } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<RequisitionStatus | undefined>(undefined);

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editableNotes, setEditableNotes] = useState("");

  const [isQuoteRequestDialogOpen, setIsQuoteRequestDialogOpen] = useState(false);
  const [isSubmittingQuoteRequest, setIsSubmittingQuoteRequest] = useState(false);
  const [availableSuppliers, setAvailableSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);

  // State for displaying current supplier pricing in dialog
  const [detailedSupplierPricing, setDetailedSupplierPricing] = useState<Record<string, Record<string, ProveedorProducto | null>>>({});
  const [loadingPricingForSupplier, setLoadingPricingForSupplier] = useState<Record<string, boolean>>({});
  const [expandedPricingForSupplier, setExpandedPricingForSupplier] = useState<Record<string, boolean>>({});


  const quoteRequestForm = useForm<QuotationRequestFormData>({
    resolver: zodResolver(quotationRequestFormSchema),
    defaultValues: {
      supplierIds: [],
      responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 
      notes: "",
    },
  });


  const fetchRequisitionData = useCallback(async () => {
    if (!requisitionId || !appUser) return;
    setIsLoading(true);
    try {
      const fetchedRequisition = await getRequisitionById(requisitionId);
      if (fetchedRequisition) {
        if (role === 'employee' && fetchedRequisition.requestingUserId !== appUser.uid) {
          toast({ title: "Access Denied", description: "You do not have permission to view this requisition.", variant: "destructive" });
          router.replace("/requisitions");
          return;
        }
        setRequisition(fetchedRequisition);
        setSelectedStatus(fetchedRequisition.status);
        setEditableNotes(fetchedRequisition.notes || "");
      } else {
        toast({ title: "Error", description: "Requisition not found.", variant: "destructive" });
        router.replace("/requisitions");
      }
    } catch (error) {
      console.error("Error fetching requisition details:", error);
      toast({ title: "Error", description: "Failed to fetch requisition details.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [requisitionId, appUser, role, router, toast]);

  useEffect(() => {
    fetchRequisitionData();
  }, [fetchRequisitionData]);

  const handleOpenQuoteRequestDialog = async () => {
    setIsLoadingSuppliers(true);
    setDetailedSupplierPricing({}); // Reset previous pricing details
    setExpandedPricingForSupplier({});
    setLoadingPricingForSupplier({});
    try {
      const suppliers = await getAllSuppliers(true); 
      setAvailableSuppliers(suppliers);
      quoteRequestForm.reset({
        supplierIds: [],
        responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notes: requisition?.notes || "", 
      });
      setIsQuoteRequestDialogOpen(true);
    } catch (error) {
      toast({ title: "Error", description: "Could not load suppliers for quotation request.", variant: "destructive" });
    }
    setIsLoadingSuppliers(false);
  };

  const toggleSupplierPricingDetails = async (supplierId: string) => {
    const isCurrentlyExpanded = !!expandedPricingForSupplier[supplierId];
    setExpandedPricingForSupplier(prev => ({ ...prev, [supplierId]: !isCurrentlyExpanded }));

    if (!isCurrentlyExpanded && !detailedSupplierPricing[supplierId] && requisition?.requiredProducts) {
      setLoadingPricingForSupplier(prev => ({ ...prev, [supplierId]: true }));
      const pricingForThisSupplier: Record<string, ProveedorProducto | null> = {};
      try {
        for (const reqProduct of requisition.requiredProducts) {
          const existingLink = await getSupplierProduct(supplierId, reqProduct.productId);
          pricingForThisSupplier[reqProduct.productId] = existingLink;
        }
        setDetailedSupplierPricing(prev => ({ ...prev, [supplierId]: pricingForThisSupplier }));
      } catch (error) {
        console.error(`Error fetching pricing for supplier ${supplierId}:`, error);
        toast({ title: "Pricing Error", description: `Could not fetch existing prices for supplier.`, variant: "destructive" });
      } finally {
        setLoadingPricingForSupplier(prev => ({ ...prev, [supplierId]: false }));
      }
    }
  };


  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierId of data.supplierIds) {
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
        };
        await createQuotation(quotationData, currentUser.uid);
        successCount++;
      } catch (error: any) {
        console.error(`Error creating quotation for supplier ${supplierId}:`, error);
        toast({
          title: `Quotation Request Failed for a supplier`,
          description: error.message || `Could not send request to supplier ${supplierId}.`,
          variant: "destructive",
        });
        errorCount++;
      }
    }
    
    if (successCount > 0) {
      toast({ title: "Quotation Requests Sent", description: `${successCount} quotation request(s) sent successfully.` });
      fetchRequisitionData(); 
    }
    if (errorCount === 0 && successCount > 0) {
      setIsQuoteRequestDialogOpen(false);
    }
    setIsSubmittingQuoteRequest(false);
  };


  const handleStatusUpdate = async () => {
    if (!requisition || !selectedStatus || selectedStatus === requisition.status) {
      toast({title: "No Change", description: "Status is already set to the selected value or no status selected.", variant: "default"});
      return;
    }
    if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update the status.", variant: "destructive" });
      return;
    }

    setIsUpdatingStatus(true);
    try {
      await updateRequisitionStatus(requisitionId, selectedStatus);
      setRequisition(prev => prev ? { ...prev, status: selectedStatus, updatedAt: Timestamp.now() } : null);
      toast({ title: "Status Updated", description: `Requisition status changed to ${selectedStatus}.` });
    } catch (error) {
      console.error("Error updating requisition status:", error);
      toast({ title: "Update Failed", description: "Could not update requisition status.", variant: "destructive" });
    }
    setIsUpdatingStatus(false);
  };

  const handleSaveNotes = async () => {
    if (!requisition || !currentUser || !canManageStatus) return;
    setIsUpdatingStatus(true);
    try {
      await updateRequisition(requisitionId, { notes: editableNotes });
      setRequisition(prev => prev ? { ...prev, notes: editableNotes, updatedAt: Timestamp.now() } : null);
      toast({ title: "Notes Updated", description: "Requisition notes have been saved." });
      setIsEditingNotes(false);
    } catch (error) {
      console.error("Error updating requisition notes:", error);
      toast({ title: "Update Failed", description: "Could not save notes.", variant: "destructive" });
    }
    setIsUpdatingStatus(false);
  };

  const handleCancelEditNotes = () => {
    setEditableNotes(requisition?.notes || "");
    setIsEditingNotes(false);
  };
  
  const formatTimestampDateTime = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    return timestamp.toDate().toLocaleString();
  };

  const getStatusBadgeVariant = (status: RequisitionStatus) => {
    switch (status) {
      case "Pending Quotation": return "secondary";
      case "Quoted": return "default";
      case "PO in Progress": return "outline";
      case "Completed": return "default";
      case "Canceled": return "destructive";
      default: return "secondary";
    }
  };
   const getStatusBadgeClass = (status: RequisitionStatus) => {
    switch (status) {
      case "Completed": return "bg-green-500 hover:bg-green-600 text-white";
      default: return "";
    }
  };


  if (isLoading && !requisition) { 
    return (
      <div className="space-y-4">
        <PageHeader title="Requisition Details" description="Loading requisition information..." />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!requisition) {
    return (
      <div className="space-y-4">
        <PageHeader title="Requisition Not Found" description="The requested requisition could not be loaded." />
        <Button onClick={() => router.push("/requisitions")} variant="outline">Back to List</Button>
      </div>
    );
  }

  const canManageStatus = role === 'admin' || role === 'superadmin';
  const canRequestQuotes = canManageStatus && (requisition.status === "Pending Quotation" || requisition.status === "Quoted");


  return (
    <>
      <PageHeader
        title={`Requisition: ${requisition.id.substring(0,8)}...`}
        description={`Details for requisition created on ${new Date(requisition.creationDate.seconds * 1000).toLocaleDateString()}`}
        actions={
          <div className="flex gap-2">
            {canRequestQuotes && (
              <Button onClick={handleOpenQuoteRequestDialog} disabled={isLoadingSuppliers}>
                <Icons.Send className="mr-2 h-4 w-4" /> Request Quotations
              </Button>
            )}
            <Button onClick={() => router.back()} variant="outline">Back to List</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">Requisition Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Requisition ID:</span><span className="font-medium truncate max-w-[150px]">{requisition.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{requisition.requestingUserName || requisition.requestingUserId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Creation Date:</span><span className="font-medium">{formatTimestampDateTime(requisition.creationDate)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(requisition.status)} className={getStatusBadgeClass(requisition.status)}>
                {requisition.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Notes:</span>
              {isEditingNotes ? (
                <div className="mt-1 space-y-2">
                  <Textarea
                    value={editableNotes}
                    onChange={(e) => setEditableNotes(e.target.value)}
                    rows={3}
                    className="w-full"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={handleCancelEditNotes}>Cancel</Button>
                    <Button size="sm" onClick={handleSaveNotes} disabled={isUpdatingStatus}>
                      {isUpdatingStatus ? <Icons.Logo className="animate-spin" /> : "Save Notes"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start">
                  <p className="font-medium whitespace-pre-wrap flex-1">{requisition.notes || "N/A"}</p>
                  {canManageStatus && (
                    <Button variant="ghost" size="icon" onClick={() => setIsEditingNotes(true)} className="ml-2 h-7 w-7">
                      <Icons.Edit className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{formatTimestampDateTime(requisition.updatedAt)}</span></div>
          </CardContent>
           {canManageStatus && (
            <CardFooter className="border-t pt-4">
                <div className="w-full space-y-2">
                    <Label htmlFor="status-update" className="font-semibold">Update Status:</Label>
                    <div className="flex gap-2">
                    <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as RequisitionStatus)}>
                        <SelectTrigger id="status-update" className="flex-1">
                        <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                        {REQUISITION_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleStatusUpdate} disabled={isUpdatingStatus || selectedStatus === requisition.status}>
                        {isUpdatingStatus ? <Icons.Logo className="animate-spin" /> : "Save Status"}
                    </Button>
                    </div>
                </div>
            </CardFooter>
           )}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Required Products</CardTitle>
            <CardDescription>List of products requested in this requisition.</CardDescription>
          </CardHeader>
          <CardContent>
            {requisition.requiredProducts && requisition.requiredProducts.length > 0 ? (
               <ScrollArea className="h-[calc(100vh-20rem)]"> 
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Required Qty</TableHead>
                      <TableHead className="text-right">Purchased Qty</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisition.requiredProducts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.requiredQuantity}</TableCell>
                        <TableCell className="text-right">{item.purchasedQuantity}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{item.notes || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <p>No products listed for this requisition.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isQuoteRequestDialogOpen} onOpenChange={setIsQuoteRequestDialogOpen}>
        <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]"> {/* Increased max-width */}
           <Form {...quoteRequestForm}>
            <form onSubmit={quoteRequestForm.handleSubmit(handleQuoteRequestSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <DialogTitle className="font-headline">Request Quotations</DialogTitle>
                <DialogDescription>
                  Select suppliers and set a response deadline for requisition: {requisition.id.substring(0,8)}...
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <div>
                  <h3 className="text-md font-semibold mb-2">Requisitioned Products:</h3>
                  <ScrollArea className="h-32 rounded-md border p-2 bg-muted/30">
                    <ul className="space-y-1 text-sm">
                      {requisition.requiredProducts?.map(rp => (
                        <li key={rp.id} className="flex justify-between">
                          <span>{rp.productName}</span>
                          <span className="text-muted-foreground">Qty: {rp.requiredQuantity}</span>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>

                <Separator />

                <FormField
                  control={quoteRequestForm.control}
                  name="supplierIds"
                  render={() => (
                    <FormItem>
                      <div className="mb-2">
                        <FormLabel className="text-base font-semibold">Suppliers *</FormLabel>
                        <p className="text-sm text-muted-foreground">Select one or more suppliers. Click <Icons.DollarSign className="inline h-3 w-3"/> to view their current pricing for requisitioned items.</p>
                      </div>
                      {availableSuppliers.length === 0 && !isLoadingSuppliers ? <p>No active suppliers found.</p> :
                      isLoadingSuppliers && availableSuppliers.length === 0 ? <p>Loading suppliers...</p> :
                      <ScrollArea className="h-48 rounded-md border p-1">
                        {availableSuppliers.map((supplier) => (
                          <div key={supplier.id} className="border-b last:border-b-0">
                            <div className="flex items-center justify-between p-2">
                                <FormField
                                control={quoteRequestForm.control}
                                name="supplierIds"
                                render={({ field }) => {
                                    return (
                                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 flex-1">
                                        <FormControl>
                                        <Checkbox
                                            checked={field.value?.includes(supplier.id)}
                                            onCheckedChange={(checked) => {
                                            return checked
                                                ? field.onChange([...(field.value || []), supplier.id])
                                                : field.onChange((field.value || []).filter((id) => id !== supplier.id));
                                            }}
                                        />
                                        </FormControl>
                                        <FormLabel className="font-normal">{supplier.name}</FormLabel>
                                    </FormItem>
                                    );
                                }}
                                />
                                <Button type="button" variant="ghost" size="sm" onClick={() => toggleSupplierPricingDetails(supplier.id)} disabled={loadingPricingForSupplier[supplier.id]}>
                                    {loadingPricingForSupplier[supplier.id] ? <Icons.Logo className="h-4 w-4 animate-spin"/> : <Icons.DollarSign className="h-4 w-4"/>}
                                    <span className="sr-only">View Current Pricing</span>
                                </Button>
                            </div>
                            {expandedPricingForSupplier[supplier.id] && (
                              <div className="p-2 ml-4 border-l border-dashed bg-background text-xs">
                                {loadingPricingForSupplier[supplier.id] ? (
                                  <p>Loading pricing...</p>
                                ) : (
                                  requisition.requiredProducts && requisition.requiredProducts.length > 0 ? (
                                    <ul className="space-y-1">
                                      {requisition.requiredProducts.map(reqProduct => {
                                        const pricing = detailedSupplierPricing[supplier.id]?.[reqProduct.productId];
                                        return (
                                          <li key={reqProduct.productId}>
                                            <span className="font-medium">{reqProduct.productName}:</span>
                                            {pricing && pricing.isActive && pricing.isAvailable ? (
                                              pricing.priceRanges.length > 0 ? (
                                                <ul className="list-disc list-inside pl-2">
                                                  {pricing.priceRanges.map((range, idx) => (
                                                    <li key={idx}>
                                                      Qty {range.minQuantity}{range.maxQuantity ? `-${range.maxQuantity}` : '+'}
                                                      : ${range.price?.toFixed(2) ?? 'N/A'} ({range.priceType})
                                                      {range.additionalConditions && <span className="text-muted-foreground text-[10px]"> ({range.additionalConditions})</span>}
                                                    </li>
                                                  ))}
                                                </ul>
                                              ) : <span className="text-muted-foreground ml-1">No price ranges defined.</span>
                                            ) : (
                                              <span className="text-muted-foreground ml-1">No active/available pricing for this supplier.</span>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  ) : (
                                    <p>No products in requisition to check pricing for.</p>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </ScrollArea> }
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={quoteRequestForm.control}
                  name="responseDeadline"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Response Deadline *</FormLabel>
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
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date < new Date(new Date().setDate(new Date().getDate() -1 )) } initialFocus/>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={quoteRequestForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes to Suppliers (Optional)</FormLabel>
                      <FormControl><Textarea placeholder="Include any general instructions or notes for all selected suppliers." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4 flex-shrink-0">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingQuoteRequest || isLoadingSuppliers || availableSuppliers.length === 0}>
                  {isSubmittingQuoteRequest ? <Icons.Logo className="animate-spin" /> : <Icons.Send />}
                  {isSubmittingQuoteRequest ? "Sending..." : "Send Requests"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

    
