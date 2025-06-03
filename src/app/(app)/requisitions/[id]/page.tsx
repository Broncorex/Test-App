
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
import { Form, FormControl, FormField, FormItem, FormMessage as ShadFormMessage, FormLabel as ShadFormLabelFromHookForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { useForm, useFieldArray, Controller } from "react-hook-form";
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
import Link from "next/link";


const quotedProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  originalRequiredQuantity: z.number(), // For reference and price tip calculation
  quotedQuantity: z.coerce.number().min(1, "Quoted quantity must be at least 1."),
});
type QuotedProductFormData = z.infer<typeof quotedProductSchema>;

const supplierQuoteDetailSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  productsToQuote: z.array(quotedProductSchema).min(1, "Must select at least one product for this supplier."),
});
type SupplierQuoteDetailFormData = z.infer<typeof supplierQuoteDetailSchema>;

const quotationRequestFormSchema = z.object({
  suppliersToQuote: z.array(supplierQuoteDetailSchema)
    .min(1, "At least one supplier must be configured for quotation.")
    .superRefine((suppliers, ctx) => {
        suppliers.forEach((supplier, index) => {
            if (supplier.productsToQuote.length === 0 && suppliers.length > 0) { // Only enforce if supplier is selected
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Supplier ${supplier.supplierName} must have at least one product selected if they are included in the request.`,
                    path: ["suppliersToQuote", index, "productsToQuote"],
                });
            }
        });
    }),
  responseDeadline: z.date({ required_error: "Response deadline is required." }),
  notes: z.string().optional(),
});
type QuotationRequestFormData = z.infer<typeof quotationRequestFormSchema>;


interface AnalyzedPriceRange {
  currentRange: PriceRange | null;
  currentPricePerUnit: number | null;
  nextBetterRange: PriceRange | null;
  quantityToReachNextBetter: number | null;
  alternativeNextRange: PriceRange | null;
}

const analyzePriceRanges = (requiredQuantity: number, priceRanges?: PriceRange[]): AnalyzedPriceRange => {
  const result: AnalyzedPriceRange = {
    currentRange: null,
    currentPricePerUnit: null,
    nextBetterRange: null,
    quantityToReachNextBetter: null,
    alternativeNextRange: null,
  };

  if (!priceRanges || priceRanges.length === 0) {
    return result;
  }

  const sortedRanges = [...priceRanges]
    .filter(range => range.price !== null && range.priceType === 'fixed') 
    .sort((a, b) => a.minQuantity - b.minQuantity);

  for (const range of sortedRanges) {
    if (requiredQuantity >= range.minQuantity && (range.maxQuantity === null || requiredQuantity <= range.maxQuantity)) {
      result.currentRange = range;
      result.currentPricePerUnit = range.price;
      break;
    }
  }
  
  if (!result.currentRange && sortedRanges.length > 0) {
    result.alternativeNextRange = sortedRanges[0];
  }

  if (result.currentPricePerUnit !== null) {
    for (const range of sortedRanges) {
      if (range.minQuantity > requiredQuantity && range.price !== null && range.price < result.currentPricePerUnit) {
        result.nextBetterRange = range;
        result.quantityToReachNextBetter = range.minQuantity - requiredQuantity;
        break; 
      }
    }
  }
  return result;
};


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
      responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      notes: "",
    },
  });

  const { fields: suppliersToQuoteFields, append: appendSupplierToQuote, remove: removeSupplierFromQuote } = useFieldArray({
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
        // Set default notes for quote request form if requisition has notes
        quoteRequestForm.reset({
            suppliersToQuote: [], // Keep suppliersToQuote empty initially
            responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            notes: fetchedRequisition.notes || "",
        });

      } else {
        toast({ title: "Error", description: "Requisition not found.", variant: "destructive" });
        router.replace("/requisitions");
      }
    } catch (error) {
      console.error("Error fetching requisition details:", error);
      toast({ title: "Error", description: "Failed to fetch requisition details.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [requisitionId, appUser, role, router, toast, quoteRequestForm]);

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
            links[supplier.id][reqProduct.productId] = null;
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
    quoteRequestForm.reset({ // Reset form but preserve notes from requisition if available
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
    const currentSuppliersToQuote = quoteRequestForm.getValues("suppliersToQuote") || [];
    const existingSupplierIndex = currentSuppliersToQuote.findIndex(s => s.supplierId === supplier.id);

    if (isChecked) {
      if (existingSupplierIndex === -1) {
        appendSupplierToQuote({
          supplierId: supplier.id,
          supplierName: supplier.name,
          productsToQuote: [], // Initialize with empty products
        });
      }
    } else {
      if (existingSupplierIndex !== -1) {
        removeSupplierFromQuote(existingSupplierIndex);
      }
    }
  };

  const toggleProductForSupplierInForm = (supplierFormIndex: number, reqProduct: RequisitionRequiredProduct, isChecked: boolean) => {
    const currentProductsToQuote = quoteRequestForm.getValues(`suppliersToQuote.${supplierFormIndex}.productsToQuote`) || [];
    const productQuoteIndex = currentProductsToQuote.findIndex(p => p.productId === reqProduct.productId);

    let newProductsToQuote: QuotedProductFormData[];

    if (isChecked) {
      if (productQuoteIndex === -1) { // Product not yet in this supplier's list
        newProductsToQuote = [
          ...currentProductsToQuote,
          {
            productId: reqProduct.productId,
            productName: reqProduct.productName,
            originalRequiredQuantity: reqProduct.requiredQuantity,
            quotedQuantity: reqProduct.requiredQuantity, // Default to original
          }
        ];
      } else { // Product already there, should not happen if checkbox logic is correct
        newProductsToQuote = [...currentProductsToQuote];
      }
    } else { // Unchecking
      if (productQuoteIndex !== -1) {
        newProductsToQuote = currentProductsToQuote.filter((_, idx) => idx !== productQuoteIndex);
      } else {
        newProductsToQuote = [...currentProductsToQuote];
      }
    }
    quoteRequestForm.setValue(`suppliersToQuote.${supplierFormIndex}.productsToQuote`, newProductsToQuote, { shouldValidate: true });
    // Trigger validation for the supplier's product list and overall list
    quoteRequestForm.trigger(`suppliersToQuote.${supplierFormIndex}.productsToQuote`);
    quoteRequestForm.trigger(`suppliersToQuote`);
  };


  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser || !requisition.requiredProducts) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierQuote of data.suppliersToQuote) {
      if (supplierQuote.productsToQuote.length === 0) {
        // This case should ideally be caught by Zod validation `min(1)` on productsToQuote if supplier is selected.
        // However, if a supplier is in the array but has no products (e.g., due to a logic bug), skip.
        console.warn(`Supplier ${supplierQuote.supplierName} has no products selected for quote. Skipping.`);
        continue;
      }
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierQuote.supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
          productDetailsToRequest: supplierQuote.productsToQuote.map(qp => ({ // Map from QuotedProductFormData
              productId: qp.productId,
              productName: qp.productName,
              requiredQuantity: qp.quotedQuantity, // Use the (potentially edited) quotedQuantity
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
    } else if (errorCount > 0 && successCount === 0) {
        // No need for specific toast if individual errors already shown
    } else if (successCount === 0 && errorCount === 0 && data.suppliersToQuote.length > 0) {
        toast({ title: "No Requests Sent", description: "Ensure products are selected for suppliers.", variant: "default" });
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
  const canCompareQuotes = canManageStatus && ["Quoted", "PO in Progress", "Completed", "Canceled", "Received", "Awarded", "Partially Awarded", "Lost"].includes(requisition.status as any); // Cast needed if Quote statuses are mixed in


  return (
    <>
      <PageHeader
        title={`Requisition: ${requisition.id.substring(0,8)}...`}
        description={`Details for requisition created on ${new Date(requisition.creationDate.seconds * 1000).toLocaleDateString()}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canRequestQuotes && (
              <Button onClick={handleOpenQuoteRequestDialog} disabled={isLoadingSuppliers || isLoadingAllSupplierLinks}>
                 { (isLoadingSuppliers || isLoadingAllSupplierLinks) ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Send className="mr-2 h-4 w-4" />}
                 Request Quotations
              </Button>
            )}
            {canCompareQuotes && (
              <Button asChild variant="outline">
                <Link href={`/requisitions/${requisition.id}/compare-quotations`}>
                    <Icons.LayoutList className="mr-2 h-4 w-4" />
                    Compare Linked Quotations
                </Link>
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
        <DialogContent className="sm:max-w-2xl md:max-w-3xl flex flex-col max-h-[90vh]">
           <Form {...quoteRequestForm}>
            <form onSubmit={quoteRequestForm.handleSubmit(handleQuoteRequestSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <DialogTitle className="font-headline">Request Quotations</DialogTitle>
                <DialogDescription>
                  Select suppliers, choose products and quantities for each, and set a response deadline for requisition: {requisition.id.substring(0,8)}...
                </DialogDescription>
              </DialogHeader>

              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <div>
                  <h3 className="text-md font-semibold mb-2">Requisitioned Products (Reference):</h3>
                  <ScrollArea className="h-32 rounded-md border p-2 bg-muted/20">
                    <ul className="space-y-1 text-sm">
                      {requisition.requiredProducts?.map(rp => (
                        <li key={rp.id} className="flex justify-between">
                          <span>{rp.productName}</span>
                          <span className="text-muted-foreground">Original Qty: {rp.requiredQuantity}</span>
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
                        <ShadFormLabelFromHookForm className="text-base font-semibold">Suppliers to Quote *</ShadFormLabelFromHookForm>
                        <p className="text-sm text-muted-foreground">
                          Select suppliers, then expand to choose products and set quantities for each.
                        </p>
                      </div>
                      {isLoadingSuppliers ? <p>Loading suppliers...</p> :
                       availableSuppliers.length === 0 ? <p>No active suppliers found.</p> :
                      <ScrollArea className="h-[calc(100vh-28rem)] md:h-72 rounded-md border p-1">
                        {availableSuppliers.map((supplier, supplierFormGlobalIndex) => {
                          const supplierLinks = allSupplierProductLinks[supplier.id] || {};
                          const hasAnyQuotableProduct = requisition.requiredProducts?.some(
                            rp => supplierLinks[rp.productId]?.isActive && supplierLinks[rp.productId]?.isAvailable
                          ) || false;
                          
                          // Find the index of this supplier in the form's suppliersToQuote array
                          const formSupplierIndex = suppliersToQuoteFields.findIndex(field => field.supplierId === supplier.id);
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
                                    onClick={(e) => e.stopPropagation()} // Prevent header click when only checkbox is clicked
                                  />
                                  <ShadFormLabelFromHookForm htmlFor={`supplier-checkbox-${supplier.id}`} className={cn("font-semibold text-md", !hasAnyQuotableProduct && "text-muted-foreground")}>
                                    {supplier.name}
                                  </ShadFormLabelFromHookForm>
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

                              {hasAnyQuotableProduct && expandedSupplierProducts[supplier.id] && isSupplierSelectedForQuoting && formSupplierIndex !== -1 && (
                                <CardContent className="p-2 pl-4 border-t">
                                  {isLoadingAllSupplierLinks && !allSupplierProductLinks[supplier.id] ? <p className="text-xs">Loading product links...</p> :
                                  !requisition.requiredProducts || requisition.requiredProducts.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No products in this requisition.</p>
                                  ) : (
                                    <div className="space-y-3">
                                      <p className="text-xs font-medium text-muted-foreground">Select products & set quantities for {supplier.name}:</p>
                                      {requisition.requiredProducts.map((reqProduct) => {
                                        const link = allSupplierProductLinks[supplier.id]?.[reqProduct.productId];
                                        const canQuoteThisProduct = !!(link && link.isActive && link.isAvailable);
                                        
                                        const productsToQuoteForThisSupplier = quoteRequestForm.watch(`suppliersToQuote.${formSupplierIndex}.productsToQuote`) || [];
                                        const productQuoteIndexInForm = productsToQuoteForThisSupplier.findIndex(pq => pq.productId === reqProduct.productId);
                                        const isProductSelectedForThisSupplierByForm = productQuoteIndexInForm !== -1;

                                        const priceAnalysis = analyzePriceRanges(reqProduct.requiredQuantity, link?.priceRanges);

                                        return (
                                          <div key={reqProduct.productId} className="p-3 rounded-md border bg-background relative">
                                            <div className="flex items-start space-x-3">
                                              <Checkbox
                                                id={`supplier-${supplier.id}-product-${reqProduct.productId}`}
                                                disabled={!canQuoteThisProduct}
                                                checked={isProductSelectedForThisSupplierByForm}
                                                onCheckedChange={(checked) => {
                                                  toggleProductForSupplierInForm(formSupplierIndex, reqProduct, !!checked);
                                                }}
                                              />
                                              <div className="flex-1 space-y-1">
                                                <ShadFormLabelFromHookForm htmlFor={`supplier-${supplier.id}-product-${reqProduct.productId}`} className="font-normal text-sm">
                                                  {reqProduct.productName} (Original Req: {reqProduct.requiredQuantity})
                                                </ShadFormLabelFromHookForm>
                                                {!canQuoteThisProduct && (
                                                  <p className="text-xs text-destructive">This supplier does not offer this product or it's unavailable.</p>
                                                )}
                                              </div>
                                            </div>

                                            {isProductSelectedForThisSupplierByForm && canQuoteThisProduct && (
                                              <div className="mt-2 pl-8 space-y-2">
                                                <FormField
                                                  control={quoteRequestForm.control}
                                                  name={`suppliersToQuote.${formSupplierIndex}.productsToQuote.${productQuoteIndexInForm}.quotedQuantity`}
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel className="text-xs">Quoted Quantity*</FormLabel>
                                                      <FormControl>
                                                        <Input type="number" {...field} className="h-8 text-sm" />
                                                      </FormControl>
                                                      <FormMessage className="text-xs"/>
                                                    </FormItem>
                                                  )}
                                                />
                                                {link && link.priceRanges.length > 0 && (
                                                  <div className="mt-1 text-xs">
                                                    {priceAnalysis.currentPricePerUnit !== null && priceAnalysis.currentRange && (
                                                      <p>
                                                        Current: <span className="font-semibold">${priceAnalysis.currentPricePerUnit.toFixed(2)}/unit</span>
                                                        (Qty: {priceAnalysis.currentRange.minQuantity}
                                                        {priceAnalysis.currentRange.maxQuantity ? `-${priceAnalysis.currentRange.maxQuantity}` : '+'})
                                                      </p>
                                                    )}
                                                    {priceAnalysis.nextBetterRange && priceAnalysis.quantityToReachNextBetter !== null && priceAnalysis.nextBetterRange.price !== null && (
                                                      <p className="text-green-600 font-medium">
                                                        Tip: Order {priceAnalysis.quantityToReachNextBetter} more (total {priceAnalysis.nextBetterRange.minQuantity}) for ${priceAnalysis.nextBetterRange.price.toFixed(2)}/unit.
                                                      </p>
                                                    )}
                                                    {priceAnalysis.alternativeNextRange && !priceAnalysis.currentRange && priceAnalysis.alternativeNextRange.price !== null &&(
                                                      <p className="text-blue-600">
                                                          Note: First available price is ${priceAnalysis.alternativeNextRange.price.toFixed(2)}/unit for {priceAnalysis.alternativeNextRange.minQuantity} units.
                                                      </p>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                      {quoteRequestForm.formState.errors.suppliersToQuote?.[formSupplierIndex]?.productsToQuote && (
                                          <ShadFormMessage className="mt-1">
                                              {typeof quoteRequestForm.formState.errors.suppliersToQuote?.[formSupplierIndex]?.productsToQuote?.message === 'string' 
                                               ? quoteRequestForm.formState.errors.suppliersToQuote?.[formSupplierIndex]?.productsToQuote?.message
                                               : "Please ensure at least one product is selected and quantities are valid." // Generic fallback for array-level error
                                              }
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
                      <ShadFormLabelFromHookForm>Response Deadline *</ShadFormLabelFromHookForm>
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
                      <ShadFormLabelFromHookForm>Notes to Suppliers (Optional)</ShadFormLabelFromHookForm>
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
