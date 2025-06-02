
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
import { Form, FormControl, FormField, FormItem, FormMessage as ShadFormMessage, FormLabel as ShadFormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { useForm, useFieldArray } from "react-hook-form";
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


const supplierQuoteDetailSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(), 
  selectedProductIds: z.array(z.string()).min(1, "Must select at least one product for this supplier."),
});

const quotationRequestFormSchema = z.object({
  suppliersToQuote: z.array(supplierQuoteDetailSchema)
    .min(1, "At least one supplier must be configured for quotation.")
    .superRefine((suppliers, ctx) => {
        suppliers.forEach((supplier, index) => {
            if (supplier.selectedProductIds.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Supplier ${supplier.supplierName} must have at least one product selected.`,
                    path: ["suppliersToQuote", index, "selectedProductIds"],
                });
            }
        });
    }),
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

  const [allSupplierProductLinks, setAllSupplierProductLinks] = useState<
    Record<string, Record<string, ProveedorProducto | null>>
  >({});
  const [isLoadingAllSupplierLinks, setIsLoadingAllSupplierLinks] = useState(false);
  const [expandedSupplierProducts, setExpandedSupplierProducts] = useState<Record<string, boolean>>({});


  const quoteRequestForm = useForm<QuotationRequestFormData>({
    resolver: zodResolver(quotationRequestFormSchema),
    defaultValues: {
      suppliersToQuote: [],
      responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days from now
      notes: "",
    },
  });

  const { fields: suppliersToQuoteFields, append: appendSupplierToQuote, remove: removeSupplierFromQuote, update: updateSupplierInQuote } = useFieldArray({
    control: quoteRequestForm.control,
    name: "suppliersToQuote",
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

  const prepareSupplierProductLinks = useCallback(async () => {
    if (!requisition?.requiredProducts || requisition.requiredProducts.length === 0 || availableSuppliers.length === 0) {
      setAllSupplierProductLinks({});
      setIsLoadingAllSupplierLinks(false);
      return;
    }
    setIsLoadingAllSupplierLinks(true);
    const links: Record<string, Record<string, ProveedorProducto | null>> = {};
    const productFetchPromises: Promise<void>[] = [];

    for (const supplier of availableSuppliers) {
      links[supplier.id] = {};
      for (const reqProduct of requisition.requiredProducts) {
        const promise = getSupplierProduct(supplier.id, reqProduct.productId)
          .then(link => {
            links[supplier.id][reqProduct.productId] = link;
          })
          .catch(error => {
            console.error(`Error fetching link for supplier ${supplier.id}, product ${reqProduct.productId}:`, error);
            links[supplier.id][reqProduct.productId] = null; // Ensure property exists
          });
        productFetchPromises.push(promise);
      }
    }
    await Promise.all(productFetchPromises);
    setAllSupplierProductLinks(links);
    setIsLoadingAllSupplierLinks(false);
  }, [requisition?.requiredProducts, availableSuppliers]);

  const handleOpenQuoteRequestDialog = async () => {
    setIsLoadingSuppliers(true);
    setExpandedSupplierProducts({});
    quoteRequestForm.reset({
        suppliersToQuote: [],
        responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notes: requisition?.notes || "",
    });
    setAllSupplierProductLinks({});

    try {
      const suppliers = await getAllSuppliers(true);
      setAvailableSuppliers(suppliers);
    } catch (error) {
      toast({ title: "Error", description: "Could not load suppliers for quotation request.", variant: "destructive" });
    }
    setIsLoadingSuppliers(false);
    setIsQuoteRequestDialogOpen(true);
  };

  useEffect(() => {
    if (isQuoteRequestDialogOpen && availableSuppliers.length > 0 && requisition?.requiredProducts && !isLoadingSuppliers) {
      prepareSupplierProductLinks();
    }
  }, [isQuoteRequestDialogOpen, availableSuppliers, requisition?.requiredProducts, isLoadingSuppliers, prepareSupplierProductLinks]);


  const toggleSupplierForQuoting = (supplier: Supplier, isChecked: boolean) => {
    const existingSupplierIndex = suppliersToQuoteFields.findIndex(s => s.supplierId === supplier.id);
    if (isChecked) {
      if (existingSupplierIndex === -1) {
        appendSupplierToQuote({
          supplierId: supplier.id,
          supplierName: supplier.name,
          selectedProductIds: [],
        });
      }
    } else {
      if (existingSupplierIndex !== -1) {
        removeSupplierFromQuote(existingSupplierIndex);
      }
    }
  };

  const toggleProductForSupplier = (supplierIndexInForm: number, productId: string, isChecked: boolean) => {
    const currentSupplierData = quoteRequestForm.getValues(`suppliersToQuote.${supplierIndexInForm}`);
    if (!currentSupplierData) return;

    let newSelectedProductIds = [...currentSupplierData.selectedProductIds];
    if (isChecked) {
      if (!newSelectedProductIds.includes(productId)) {
        newSelectedProductIds.push(productId);
      }
    } else {
      newSelectedProductIds = newSelectedProductIds.filter(id => id !== productId);
    }
    updateSupplierInQuote(supplierIndexInForm, {
        ...currentSupplierData,
        selectedProductIds: newSelectedProductIds,
    });
    quoteRequestForm.trigger(`suppliersToQuote.${supplierIndexInForm}.selectedProductIds`);
  };


  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser || !requisition.requiredProducts) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierQuote of data.suppliersToQuote) {
      if (supplierQuote.selectedProductIds.length === 0) {
        toast({
          title: `No products selected for ${supplierQuote.supplierName}`,
          description: "Please select products or uncheck the supplier.",
          variant: "destructive",
        });
        errorCount++;
        continue;
      }
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierQuote.supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
          productDetailsToRequest: requisition.requiredProducts
            .filter(rp => supplierQuote.selectedProductIds.includes(rp.productId))
            .map(rp => ({
                productId: rp.productId,
                productName: rp.productName,
                requiredQuantity: rp.requiredQuantity,
            }))
        };
        await createQuotation(quotationData, currentUser.uid);
        successCount++;
      } catch (error: any) {
        console.error(`Error creating quotation for supplier ${supplierQuote.supplierName}:`, error);
        toast({
          title: `Request Failed for ${supplierQuote.supplierName}`,
          description: error.message || `Could not send request.`,
          variant: "destructive",
        });
        errorCount++;
      }
    }

    if (successCount > 0 && errorCount === 0) {
      toast({ title: "Quotation Requests Sent", description: `${successCount} quotation request(s) initiated.` });
      setIsQuoteRequestDialogOpen(false);
      fetchRequisitionData();
    } else if (successCount > 0 && errorCount > 0) {
      toast({ title: "Partial Success", description: `${successCount} request(s) initiated, ${errorCount} failed.`, variant: "default" });
    }
    setIsSubmittingQuoteRequest(false);
  };


  const handleStatusUpdate = async () => {
    if (!requisition || !selectedStatus || selectedStatus === requisition.status) {
      toast({title: "No Change", description: "Status is already set or no status selected.", variant: "default"});
      return;
    }
    if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update status.", variant: "destructive" });
      return;
    }

    setIsUpdatingStatus(true);
    try {
      await updateRequisitionStatus(requisitionId, selectedStatus);
      setRequisition(prev => prev ? { ...prev, status: selectedStatus, updatedAt: Timestamp.now() } : null);
      toast({ title: "Status Updated", description: `Requisition status changed to ${selectedStatus}.` });
    } catch (error) {
      console.error("Error updating requisition status:", error);
      toast({ title: "Update Failed", description: "Could not update status.", variant: "destructive" });
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
        <PageHeader title="Requisition Not Found" description="Requested requisition could not be loaded." />
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
              <Button onClick={handleOpenQuoteRequestDialog} disabled={isLoadingSuppliers || isLoadingAllSupplierLinks}>
                 { (isLoadingSuppliers || isLoadingAllSupplierLinks) ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Send className="mr-2 h-4 w-4" />}
                 Request Quotations
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
                    <ShadFormLabel htmlFor="status-update" className="font-semibold">Update Status:</ShadFormLabel>
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
        <DialogContent className="sm:max-w-2xl md:max-w-3xl flex flex-col max-h-[90vh]">
           <Form {...quoteRequestForm}>
            <form onSubmit={quoteRequestForm.handleSubmit(handleQuoteRequestSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <DialogTitle className="font-headline">Request Quotations</DialogTitle>
                <DialogDescription>
                  Select suppliers, choose products for each, and set a response deadline for requisition: {requisition.id.substring(0,8)}...
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <div>
                  <h3 className="text-md font-semibold mb-2">Requisitioned Products (Read-only):</h3>
                  <ScrollArea className="h-32 rounded-md border p-2 bg-muted/20">
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
                  name="suppliersToQuote"
                  render={() => (
                    <FormItem>
                      <div className="mb-2">
                        <ShadFormLabel className="text-base font-semibold">Suppliers to Quote *</ShadFormLabel>
                        <p className="text-sm text-muted-foreground">
                          Select suppliers, then expand to choose products for each. Applicable price ranges are shown.
                        </p>
                      </div>
                      {isLoadingSuppliers ? <p>Loading suppliers...</p> :
                       availableSuppliers.length === 0 ? <p>No active suppliers found.</p> :
                      <ScrollArea className="h-64 rounded-md border p-1">
                        {availableSuppliers.map((supplier) => {
                          const supplierLinks = allSupplierProductLinks[supplier.id] || {};
                          const hasAnyQuotableProduct = requisition.requiredProducts?.some(
                            rp => supplierLinks[rp.productId]?.isActive && supplierLinks[rp.productId]?.isAvailable
                          ) || false;
                          
                          const formSupplierIndex = suppliersToQuoteFields.findIndex(s => s.supplierId === supplier.id);
                          const isSupplierSelectedForQuoting = formSupplierIndex !== -1;

                          return (
                            <Card key={supplier.id} className={cn("mb-2 bg-muted/10", !hasAnyQuotableProduct && "opacity-60")}>
                              <CardHeader 
                                className="p-2 flex flex-row items-center justify-between cursor-pointer hover:bg-muted/20"
                                onClick={() => {
                                  if (hasAnyQuotableProduct) {
                                    setExpandedSupplierProducts(prev => ({ ...prev, [supplier.id]: !prev[supplier.id] }))
                                  }
                                }}
                              >
                                <div className="flex items-center space-x-3">
                                  <Checkbox
                                    id={`supplier-checkbox-${supplier.id}`}
                                    checked={isSupplierSelectedForQuoting}
                                    disabled={!hasAnyQuotableProduct && !isSupplierSelectedForQuoting}
                                    onCheckedChange={(checked) => {
                                      if (hasAnyQuotableProduct || !checked) {
                                        toggleSupplierForQuoting(supplier, !!checked);
                                        if (checked && !expandedSupplierProducts[supplier.id] && hasAnyQuotableProduct) {
                                          setExpandedSupplierProducts(prev => ({ ...prev, [supplier.id]: true }));
                                        }
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()} 
                                  />
                                  <ShadFormLabel htmlFor={`supplier-checkbox-${supplier.id}`} className={cn("font-semibold text-md", !hasAnyQuotableProduct && "text-muted-foreground")}>
                                    {supplier.name}
                                  </ShadFormLabel>
                                </div>
                                {hasAnyQuotableProduct && (
                                  <Button type="button" variant="ghost" size="sm" className="p-1 h-auto">
                                    {expandedSupplierProducts[supplier.id] ? <Icons.ChevronDown className="h-4 w-4 rotate-180" /> : <Icons.ChevronDown className="h-4 w-4" />}
                                  </Button>
                                )}
                              </CardHeader>

                              {!hasAnyQuotableProduct && (
                                <CardContent className="p-2 pt-0 text-xs text-muted-foreground">
                                  This supplier does not have active links for any products in this requisition.
                                </CardContent>
                              )}

                              {hasAnyQuotableProduct && expandedSupplierProducts[supplier.id] && (
                                <CardContent className="p-2 pl-4 border-t">
                                  {isLoadingAllSupplierLinks && !allSupplierProductLinks[supplier.id] ? <p className="text-xs">Loading product links...</p> :
                                  !requisition.requiredProducts || requisition.requiredProducts.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No products in this requisition.</p>
                                  ) : (
                                    <div className="space-y-3">
                                      <p className="text-xs font-medium text-muted-foreground">Select products to quote from {supplier.name}:</p>
                                      {requisition.requiredProducts.map((reqProduct) => {
                                        const link = allSupplierProductLinks[supplier.id]?.[reqProduct.productId];
                                        const canQuoteThisProduct = !!(link && link.isActive && link.isAvailable);
                                        const currentSupplierFormData = suppliersToQuoteFields[formSupplierIndex];

                                        let applicablePriceRange: PriceRange | null = null;
                                        if (link && link.priceRanges) {
                                          for (const range of link.priceRanges) {
                                            const meetsMin = reqProduct.requiredQuantity >= range.minQuantity;
                                            const meetsMax = range.maxQuantity === null || reqProduct.requiredQuantity <= range.maxQuantity;
                                            if (meetsMin && meetsMax) {
                                              applicablePriceRange = range;
                                              break; 
                                            }
                                          }
                                        }

                                        return (
                                          <div key={reqProduct.productId} className="p-2 rounded-md border bg-background relative">
                                            <FormField
                                              control={quoteRequestForm.control}
                                              name={`suppliersToQuote.${formSupplierIndex}.selectedProductIds`}
                                              render={() => (
                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                  <FormControl>
                                                    <Checkbox
                                                      disabled={!canQuoteThisProduct || !isSupplierSelectedForQuoting}
                                                      checked={isSupplierSelectedForQuoting && currentSupplierFormData?.selectedProductIds.includes(reqProduct.productId)}
                                                      onCheckedChange={(checked) => {
                                                        if (isSupplierSelectedForQuoting && formSupplierIndex !== -1) {
                                                          toggleProductForSupplier(formSupplierIndex, reqProduct.productId, !!checked);
                                                        }
                                                      }}
                                                    />
                                                  </FormControl>
                                                  <div className="flex-1">
                                                    <ShadFormLabel className="font-normal text-sm">
                                                      {reqProduct.productName} (Req. Qty: {reqProduct.requiredQuantity})
                                                    </ShadFormLabel>
                                                    {!canQuoteThisProduct && (
                                                      <p className="text-xs text-destructive">This supplier does not offer this product or it's unavailable.</p>
                                                    )}
                                                  </div>
                                                </FormItem>
                                              )}
                                            />
                                            {canQuoteThisProduct && link && link.priceRanges.length > 0 && (
                                              <div className="mt-1 pl-8 text-xs">
                                                <p className="font-medium text-muted-foreground">Current Price Ranges:</p>
                                                <ul className="list-disc list-inside">
                                                  {link.priceRanges.map((range, idx) => {
                                                    const isApplicable = applicablePriceRange === range;
                                                    return (
                                                      <li key={idx} className={cn(isApplicable && "bg-primary/10 p-1 rounded-sm")}>
                                                        Qty {range.minQuantity}{range.maxQuantity ? `-${range.maxQuantity}` : '+'}
                                                        : <span className={cn(isApplicable && "font-bold text-primary")}>${range.price?.toFixed(2) ?? 'N/A'}</span> ({range.priceType})
                                                        {range.additionalConditions && <span className="text-muted-foreground text-[10px]"> ({range.additionalConditions})</span>}
                                                        {isApplicable && <Badge variant="outline" className="ml-1 text-xs px-1 py-0 h-auto border-primary text-primary">Applicable</Badge>}
                                                      </li>
                                                    );
                                                  })}
                                                </ul>
                                              </div>
                                            )}
                                            {canQuoteThisProduct && (!link || link.priceRanges.length === 0) && (
                                               <p className="mt-1 pl-8 text-xs text-muted-foreground">No predefined price ranges for this product.</p>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {quoteRequestForm.formState.errors.suppliersToQuote?.[formSupplierIndex]?.selectedProductIds && (
                                          <ShadFormMessage className="mt-1">
                                              {quoteRequestForm.formState.errors.suppliersToQuote?.[formSupplierIndex]?.selectedProductIds?.message}
                                          </ShadFormMessage>
                                      )}
                                    </div>
                                  )}
                                </CardContent>
                              )}
                            </Card>
                          );
                        })}
                      </ScrollArea>
                      }
                      {quoteRequestForm.formState.errors.suppliersToQuote && typeof quoteRequestForm.formState.errors.suppliersToQuote.message === 'string' && (
                         <ShadFormMessage className="pt-1">
                            {quoteRequestForm.formState.errors.suppliersToQuote.message}
                        </ShadFormMessage>
                      )}
                       {quoteRequestForm.formState.errors.suppliersToQuote?.root && (
                         <ShadFormMessage className="pt-1">
                            {quoteRequestForm.formState.errors.suppliersToQuote.root.message}
                        </ShadFormMessage>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={quoteRequestForm.control}
                  name="responseDeadline"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <ShadFormLabel>Response Deadline *</ShadFormLabel>
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
                      <ShadFormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={quoteRequestForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <ShadFormLabel>Notes to Suppliers (Optional)</ShadFormLabel>
                      <FormControl><Textarea placeholder="General instructions for all selected suppliers." {...field} /></FormControl>
                      <ShadFormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4 flex-shrink-0">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button 
                    type="submit" 
                    disabled={isSubmittingQuoteRequest || isLoadingSuppliers || isLoadingAllSupplierLinks || availableSuppliers.length === 0 || !requisition.requiredProducts || requisition.requiredProducts.length === 0}
                >
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

