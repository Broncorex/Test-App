"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getRequisitionById, updateRequisitionStatus, updateRequisition, type UpdateRequisitionData } from "@/services/requisitionService";
import type { Requisition, RequisitionStatus, RequiredProduct as RequisitionRequiredProductType, Supplier, ProveedorProducto, PriceRange } from "@/types"; // Renamed RequiredProduct to avoid conflict
import { REQUISITION_STATUSES } from "@/types";
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icons } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage as ShadFormMessage,
  FormLabel as ShadFormLabelFromHookForm
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isValid } from "date-fns";
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
  productId: z.string().min(1, "Product ID is required"),
  productName: z.string(),
  originalRequiredQuantity: z.number(),
  quotedQuantity: z.coerce.number().min(1, "Quoted quantity must be at least 1."),
});
type QuotedProductFormData = z.infer<typeof quotedProductSchema>;

const supplierQuoteDetailSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  productsToQuote: z.array(quotedProductSchema).default([]).optional(), // SUGGESTION: Initialize with default([]) and optional() is fine with superRefine
});
type SupplierQuoteDetailFormData = z.infer<typeof supplierQuoteDetailSchema>;

const quotationRequestFormSchema = z.object({
  suppliersToQuote: z.array(supplierQuoteDetailSchema)
    .min(1, "At least one supplier must be selected for quotation.")
    .superRefine((suppliers, ctx) => {
      suppliers.forEach((supplierItem, index) => {
        // supplierItem.productsToQuote can be undefined if optional() is kept and no default is set from append
        // or it will be [] if .default([]) is used and append initializes with []
        if (!supplierItem.productsToQuote || supplierItem.productsToQuote.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Supplier "${supplierItem.supplierName}" must have at least one product selected to be included in the quote request.`,
            path: [index, "productsToQuote"], // Correct path
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

  const memoizedAnalyzePriceRanges = useCallback((originalRequiredQuantity: number, priceRangesParam?: PriceRange[]): AnalyzedPriceRange => {
    const result: AnalyzedPriceRange = {
      currentRange: null,
      currentPricePerUnit: null,
      nextBetterRange: null,
      quantityToReachNextBetter: null,
      alternativeNextRange: null,
    };

    if (!priceRangesParam || priceRangesParam.length === 0 || isNaN(originalRequiredQuantity) || originalRequiredQuantity <= 0) {
      return result;
    }

    const sortedRanges = [...priceRangesParam]
      .filter(range => range.price !== null && range.priceType === 'fixed')
      .sort((a, b) => a.minQuantity - b.minQuantity);

    for (const range of sortedRanges) {
      if (originalRequiredQuantity >= range.minQuantity && (range.maxQuantity === null || originalRequiredQuantity <= range.maxQuantity)) {
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
        if (range.minQuantity > originalRequiredQuantity && range.price !== null && range.price < result.currentPricePerUnit) {
          result.nextBetterRange = range;
          result.quantityToReachNextBetter = range.minQuantity - originalRequiredQuantity;
          break;
        }
      }
    }
    return result;
  }, []);

  const getApplicablePriceRange = useCallback((quantity: number, priceRangesParam?: PriceRange[]): PriceRange | null => {
    if (!priceRangesParam || priceRangesParam.length === 0 || isNaN(quantity) || quantity <= 0) {
      return null;
    }
    const sortedRanges = [...priceRangesParam]
      .filter(range => range.price !== null && range.priceType === 'fixed')
      .sort((a, b) => a.minQuantity - b.minQuantity);

    for (const range of sortedRanges) {
      if (quantity >= range.minQuantity && (range.maxQuantity === null || quantity <= range.maxQuantity)) {
        return range;
      }
    }
    return null;
  }, []);


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
        quoteRequestForm.reset({
          suppliersToQuote: [], // Reset with empty array
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

    try {
      const batchSize = 3; 
      for (let i = 0; i < availableSuppliers.length; i += batchSize) {
        const supplierBatch = availableSuppliers.slice(i, i + batchSize);

        await Promise.all(
          supplierBatch.map(async (supplier) => {
            links[supplier.id] = {};
            if (requisition.requiredProducts) { // Null check for requiredProducts
                const productPromises = requisition.requiredProducts.map(async (reqProduct) => {
                try {
                    const link = await getSupplierProduct(supplier.id, reqProduct.productId);
                    links[supplier.id][reqProduct.productId] = link;
                } catch (error) {
                    console.error(`Error fetching link for supplier ${supplier.id}, product ${reqProduct.productId}:`, error);
                    links[supplier.id][reqProduct.productId] = null;
                }
                });
                await Promise.all(productPromises);
            }
          })
        );
        setAllSupplierProductLinks(prevLinks => ({ ...prevLinks, ...links })); // Merge progressively
      }
    } catch (error) {
      console.error('Error in prepareSupplierProductLinks:', error);
      toast({ title: "Error", description: "Failed to load some supplier product links.", variant: "destructive" });
    } finally {
      setIsLoadingAllSupplierLinks(false);
    }
  }, [requisition?.requiredProducts, availableSuppliers, toast]);

  const handleOpenQuoteRequestDialog = async () => {
    setIsLoadingSuppliers(true);
    setExpandedSupplierProducts({});
    quoteRequestForm.reset({
      suppliersToQuote: [], // Ensure it's an array
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
    const supplierFieldArrayIndex = suppliersToQuoteFields.findIndex(sField => sField.supplierId === supplier.id);

    if (isChecked) {
      if (supplierFieldArrayIndex === -1) { // If not already in the RHF fields array
        appendSupplierToQuote({
          supplierId: supplier.id,
          supplierName: supplier.name,
          productsToQuote: [], // MODIFIED: Initialize with an empty array
        });
      }
    } else {
      if (supplierFieldArrayIndex !== -1) { // If it exists in the RHF fields array
        removeSupplierFromQuote(supplierFieldArrayIndex);
      }
    }
  };
  
  const toggleProductForSupplierInForm = (
    supplierFormIndex: number, // This is the index in the suppliersToQuoteFields array
    reqProduct: RequisitionRequiredProductType,
    isChecked: boolean
  ) => {
    // Get current products for this supplier directly from form state, then update
    const currentSupplierData = quoteRequestForm.getValues(`suppliersToQuote.${supplierFormIndex}`);
    if (!currentSupplierData) return; // Should not happen if supplierFormIndex is valid

    // Ensure productsToQuote is an array; if it's undefined (e.g. from initial state), treat as empty
    const currentProductsToQuote = currentSupplierData.productsToQuote || []; 
    const productQuoteIndex = currentProductsToQuote.findIndex(p => p.productId === reqProduct.productId);

    let newProductsToQuote: QuotedProductFormData[];

    if (isChecked) {
      if (productQuoteIndex === -1) { // Product not yet in the list for this supplier
        newProductsToQuote = [
          ...currentProductsToQuote,
          {
            productId: reqProduct.productId,
            productName: reqProduct.productName,
            originalRequiredQuantity: reqProduct.requiredQuantity,
            quotedQuantity: reqProduct.requiredQuantity, // Default quoted to required
          }
        ];
      } else {
        newProductsToQuote = [...currentProductsToQuote]; // Already there, no change to list structure needed
      }
    } else { // If unchecking the product
      if (productQuoteIndex !== -1) { // Product is in the list, remove it
        newProductsToQuote = currentProductsToQuote.filter(p => p.productId !== reqProduct.productId);
      } else {
        newProductsToQuote = [...currentProductsToQuote]; // Not in the list, no change
      }
    }

    quoteRequestForm.setValue(
      `suppliersToQuote.${supplierFormIndex}.productsToQuote`,
      newProductsToQuote, // MODIFIED: Always pass the array (it will be empty if no products)
      { shouldValidate: true, shouldDirty: true, shouldTouch: true }
    );

    // Trigger validation for the specific product array and the entire suppliers array
    // This helps ensure superRefine rules are checked and UI updates properly
    quoteRequestForm.trigger(`suppliersToQuote.${supplierFormIndex}.productsToQuote`);
    quoteRequestForm.trigger(`suppliersToQuote`);
  };


  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser || !requisition.requiredProducts) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierQuote of data.suppliersToQuote) {
      // productsToQuote will be [] if no products, or undefined if schema allows and not set
      // The superRefine should prevent submission if productsToQuote is empty/undefined for a selected supplier
      if (!supplierQuote.productsToQuote || supplierQuote.productsToQuote.length === 0) {
        console.warn(`Supplier ${supplierQuote.supplierName} has no products selected for quote. Skipping (SuperRefine should have caught this).`);
        continue; 
      }
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierQuote.supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
          productDetailsToRequest: supplierQuote.productsToQuote.map(qp => ({ // map will work on []
            productId: qp.productId,
            productName: qp.productName, 
            requiredQuantity: qp.quotedQuantity, 
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
      fetchRequisitionData(); // Re-fetch to update related data if any
    } else if (successCount > 0 && errorCount > 0) {
      toast({ title: "Partial Success", description: `${successCount} request(s) initiated, ${errorCount} failed.`, variant: "default" });
    } else if (errorCount > 0 && successCount === 0) {
      toast({ title: "All Requests Failed", description: "No quotation requests could be sent.", variant: "destructive" });
    } else if (successCount === 0 && errorCount === 0 && data.suppliersToQuote.length > 0) {
      // This case implies superRefine might not have run or there's another issue
      toast({ title: "No Requests Sent", description: "Ensure products are selected for each chosen supplier.", variant: "default" });
    } else if (data.suppliersToQuote.length === 0) { // No suppliers were in the form data to begin with
       toast({ title: "No Suppliers Processed", description: "No suppliers were submitted for quotation requests.", variant: "default" });
    }
    setIsSubmittingQuoteRequest(false);
  };


  const handleStatusUpdate = async () => {
    if (!requisition || !selectedStatus || selectedStatus === requisition.status) {
      toast({ title: "No Change", description: "Status is already set or no status selected.", variant: "default" });
      return;
    }
    if (role === 'employee' && requisition.requestingUserId === currentUser?.uid && requisition.status === "Pending Quotation" && selectedStatus === "Canceled") {
      // Allow
    } else if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update status for this requisition.", variant: "destructive" });
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
    if (!requisition || !currentUser) return;
    if (role !== 'admin' && role !== 'superadmin' && requisition.requestingUserId !== currentUser.uid) {
      toast({ title: "Permission Denied", description: "You cannot edit notes for this requisition.", variant: "destructive" });
      return;
    }
    if (requisition.status !== "Pending Quotation" && role === 'employee') {
      toast({ title: "Action Denied", description: "Notes can only be edited by employees when requisition is 'Pending Quotation'.", variant: "default" });
      return;
    }

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

  const supplierAnalysisData = useMemo(() => {
    if (!requisition?.requiredProducts || requisition.requiredProducts.length === 0 || !availableSuppliers.length || !allSupplierProductLinks) {
      return {};
    }

    const analysisData: Record<string, Record<string, {
      priceAnalysis: AnalyzedPriceRange;
      canQuoteProduct: boolean;
      link: ProveedorProducto | null;
    }>> = {};

    availableSuppliers.forEach(supplier => {
      analysisData[supplier.id] = {};
      const supplierLinks = allSupplierProductLinks[supplier.id] || {};

      requisition.requiredProducts!.forEach(reqProduct => {
        const link = supplierLinks[reqProduct.productId];
        const canQuoteProduct = !!(link && link.isActive && link.isAvailable);
        const priceAnalysis = memoizedAnalyzePriceRanges(reqProduct.requiredQuantity, link?.priceRanges);

        analysisData[supplier.id][reqProduct.productId] = {
          priceAnalysis,
          canQuoteProduct,
          link
        };
      });
    });
    return analysisData;
  }, [requisition?.requiredProducts, availableSuppliers, allSupplierProductLinks, memoizedAnalyzePriceRanges]);


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

  const canManageStatus = role === 'admin' || role === 'superadmin' || (role === 'employee' && requisition.requestingUserId === currentUser?.uid && requisition.status === "Pending Quotation");
  const canEditNotes = (role === 'admin' || role === 'superadmin') || (role === 'employee' && requisition.requestingUserId === currentUser?.uid && requisition.status === "Pending Quotation");
  const canRequestQuotes = (role === 'admin' || role === 'superadmin') && (requisition.status === "Pending Quotation" || requisition.status === "Quoted");
  const canCompareQuotes = (role === 'admin' || role === 'superadmin') && ["Quoted", "PO in Progress", "Completed", "Canceled"].includes(requisition.status);


  return (
    <>
      <PageHeader
        title={`Requisition: ${requisition.id.substring(0, 8)}...`}
        description={`Details for requisition created on ${new Date(requisition.creationDate.seconds * 1000).toLocaleDateString()}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canRequestQuotes && (
              <Button onClick={handleOpenQuoteRequestDialog} disabled={isLoadingSuppliers || isLoadingAllSupplierLinks}>
                {(isLoadingSuppliers || isLoadingAllSupplierLinks) ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Send className="mr-2 h-4 w-4" />}
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
                  {canEditNotes && (
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
                        <SelectItem
                          key={s}
                          value={s}
                          disabled={
                            role === 'employee' &&
                            requisition.requestingUserId === currentUser?.uid && // only for the requester
                            requisition.status === "Pending Quotation" &&
                            s !== "Canceled" && // can cancel
                            s !== "Pending Quotation" // can revert to pending
                          }
                        >
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleStatusUpdate}
                    disabled={isUpdatingStatus || !selectedStatus || selectedStatus === requisition.status || (role === 'employee' && requisition.requestingUserId === currentUser?.uid && requisition.status === "Pending Quotation" && selectedStatus !== "Canceled" && selectedStatus !== "Pending Quotation")}
                  >
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
              <ScrollArea className="h-[calc(100vh-20rem)]"> {/* Consider adjusting height if needed */}
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
                      <TableRow key={item.id}> {/* Assuming item.id is unique per product in requisition */}
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
                  Select suppliers, choose products and quantities for each, and set a response deadline for requisition: {requisition.id.substring(0, 8)}...
                </DialogDescription>
              </DialogHeader>

              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4"> {/* pr-2 to prevent scrollbar overlap */}
                <div>
                  <h3 className="text-md font-semibold mb-2">Requisitioned Products (Reference):</h3>
                  <ScrollArea className="h-32 rounded-md border p-2 bg-muted/20">
                    <ul className="space-y-1 text-sm">
                      {requisition.requiredProducts?.map(rp => (
                        <li key={rp.id} className="flex justify-between"> {/* rp.id should be unique */}
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
                  name="suppliersToQuote" // This field itself will show errors from superRefine
                  render={() => ( // We don't use field from render here, but access via useFieldArray
                    <FormItem>
                      <div className="mb-2">
                        <ShadFormLabelFromHookForm className="text-base font-semibold">Suppliers to Quote *</ShadFormLabelFromHookForm>
                        <p className="text-sm text-muted-foreground">
                          Select suppliers, then expand to choose products and set quoted quantities for each.
                        </p>
                      </div>
                      {isLoadingSuppliers ? <p>Loading suppliers...</p> :
                        availableSuppliers.length === 0 ? <p>No active suppliers found.</p> :
                          <ScrollArea className="h-[calc(100vh-28rem)] md:h-72 rounded-md border p-1">
                            {/* Use suppliersToQuoteFields for rendering selected suppliers in form */}
                            {/* Iterate over availableSuppliers to show all options */}
                            {availableSuppliers.map((supplier) => {
                              // Find the corresponding field in RHF's useFieldArray
                              const actualSupplierFormIndex = suppliersToQuoteFields.findIndex(sField => sField.supplierId === supplier.id);
                              const isSupplierSelectedForQuoting = actualSupplierFormIndex !== -1;
                              
                              // Get products for this supplier *from the form state* if selected
                              const productsForThisSupplierInForm = isSupplierSelectedForQuoting
                                ? (suppliersToQuoteFields[actualSupplierFormIndex] as SupplierQuoteDetailFormData).productsToQuote || [] // Ensure it's an array
                                : [];

                              const hasAnyQuotableProduct = requisition.requiredProducts?.some(
                                rp => supplierAnalysisData[supplier.id]?.[rp.productId]?.canQuoteProduct
                              ) || false;

                              return (
                                <Card key={supplier.id} className={cn("mb-2 bg-muted/10", !hasAnyQuotableProduct && "opacity-60")}>
                                  <CardHeader
                                    className="p-2 flex flex-row items-center justify-between cursor-pointer hover:bg-muted/20"
                                    onClick={() => {
                                      if (hasAnyQuotableProduct && isSupplierSelectedForQuoting) { // Only allow expand/collapse if selected and has products
                                        setExpandedSupplierProducts(prev => ({ ...prev, [supplier.id]: !prev[supplier.id] }))
                                      }
                                    }}
                                  >
                                    <div className="flex items-center space-x-3">
                                      <Checkbox
                                        id={`supplier-checkbox-${supplier.id}`}
                                        checked={isSupplierSelectedForQuoting}
                                        disabled={!hasAnyQuotableProduct && !isSupplierSelectedForQuoting} // Disable if no quotable products, unless already selected (to allow unselecting)
                                        onCheckedChange={(checked) => {
                                          toggleSupplierForQuoting(supplier, !!checked);
                                          if (checked && !expandedSupplierProducts[supplier.id] && hasAnyQuotableProduct) {
                                            setExpandedSupplierProducts(prev => ({ ...prev, [supplier.id]: true }));
                                          } else if (!checked) {
                                            setExpandedSupplierProducts(prev => ({ ...prev, [supplier.id]: false }));
                                          }
                                        }}
                                        onClick={(e) => e.stopPropagation()} 
                                      />
                                      <ShadFormLabelFromHookForm htmlFor={`supplier-checkbox-${supplier.id}`} className={cn("font-semibold text-md cursor-pointer", !hasAnyQuotableProduct && "text-muted-foreground")}>
                                        {supplier.name}
                                      </ShadFormLabelFromHookForm>
                                    </div>
                                    {hasAnyQuotableProduct && isSupplierSelectedForQuoting && ( // Show chevron only if expandable
                                      <Button type="button" variant="ghost" size="sm" className="p-1 h-auto">
                                        {expandedSupplierProducts[supplier.id] ? <Icons.ChevronUp className="h-4 w-4" /> : <Icons.ChevronDown className="h-4 w-4" />}
                                      </Button>
                                    )}
                                  </CardHeader>

                                  {!hasAnyQuotableProduct && (
                                    <CardContent className="p-2 pt-0 text-xs text-muted-foreground">
                                      This supplier does not have active product links for items in this requisition.
                                    </CardContent>
                                  )}

                                  {/* Content: Show if supplier is selected, expanded, and has quotable products */}
                                  {isSupplierSelectedForQuoting && expandedSupplierProducts[supplier.id] && hasAnyQuotableProduct && (
                                    <CardContent className="p-2 pl-4 border-t">
                                      {isLoadingAllSupplierLinks && !allSupplierProductLinks[supplier.id] ? (
                                        <div className="space-y-2">
                                          <Skeleton className="h-4 w-3/4 mb-2" />
                                          <Skeleton className="h-10 w-full" />
                                          <Skeleton className="h-6 w-1/2" />
                                          <Skeleton className="h-24 w-full" />
                                        </div>
                                      ) : !requisition.requiredProducts || requisition.requiredProducts.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No products in this requisition to quote for.</p>
                                      ) : (
                                        <div className="space-y-3">
                                          <p className="text-xs font-medium text-muted-foreground">Select products & set quantities for {supplier.name}:</p>
                                          {requisition.requiredProducts.map((reqProduct) => {
                                            const productAnalysis = supplierAnalysisData[supplier.id]?.[reqProduct.productId];
                                            const link = productAnalysis?.link || null;
                                            const canQuoteThisProduct = productAnalysis?.canQuoteProduct || false;
                                            const priceAnalysis = productAnalysis?.priceAnalysis || { /* default empty object */ };
                                            
                                            // Check if this product is selected FOR THIS SUPPLIER IN THE FORM
                                            const productIsSelectedForThisSupplier = productsForThisSupplierInForm.some(p => p.productId === reqProduct.productId);
                                            // Find its index IN THE FORM's product list for this supplier
                                            const currentProductQuoteIndex = productsForThisSupplierInForm.findIndex(p => p.productId === reqProduct.productId);
                                            
                                            const watchedQuotedQuantity = productIsSelectedForThisSupplier && currentProductQuoteIndex !== -1
                                              ? quoteRequestForm.watch(`suppliersToQuote.${actualSupplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`)
                                              : reqProduct.requiredQuantity; // Default to original if not selected or index issue
                                            const numericWatchedQty = Number(watchedQuotedQuantity);
                                            const applicableRangeForWatchedQty = getApplicablePriceRange(numericWatchedQty, link?.priceRanges);

                                            return (
                                              <div key={reqProduct.productId} className="p-3 rounded-md border bg-background relative">
                                                <div className="flex items-start space-x-3">
                                                  <Checkbox
                                                    id={`supplier-${supplier.id}-product-${reqProduct.productId}`}
                                                    disabled={!canQuoteThisProduct} // Only disable if supplier cannot quote it at all
                                                    checked={productIsSelectedForThisSupplier}
                                                    onCheckedChange={(checked) => {
                                                      // actualSupplierFormIndex must be valid (supplier is selected)
                                                      if (actualSupplierFormIndex !== -1) { 
                                                        toggleProductForSupplierInForm(actualSupplierFormIndex, reqProduct, !!checked);
                                                      }
                                                    }}
                                                  />
                                                  <div className="flex-1 space-y-1">
                                                    <ShadFormLabelFromHookForm htmlFor={`supplier-${supplier.id}-product-${reqProduct.productId}`} className="font-normal text-sm cursor-pointer">
                                                      {reqProduct.productName} (Orig. Req: {reqProduct.requiredQuantity})
                                                    </ShadFormLabelFromHookForm>
                                                    {!canQuoteThisProduct && (
                                                      <p className="text-xs text-destructive">This supplier does not offer this product or it's unavailable.</p>
                                                    )}
                                                  </div>
                                                </div>

                                                {/* Sub-form for quantity, shown if product is selected for this supplier */}
                                                {productIsSelectedForThisSupplier && canQuoteThisProduct && currentProductQuoteIndex !== -1 && (
                                                  <div className="mt-2 pl-8 space-y-2">
                                                    <FormField
                                                      control={quoteRequestForm.control}
                                                      name={`suppliersToQuote.${actualSupplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`}
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <ShadFormLabelFromHookForm className="text-xs">Quoted Quantity*</ShadFormLabelFromHookForm>
                                                          <FormControl>
                                                            <Input type="number" {...field} className="h-8 text-sm" />
                                                          </FormControl>
                                                          <ShadFormMessage className="text-xs" />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    {/* Price analysis and tiers */}
                                                    {link?.priceRanges && link.priceRanges.length > 0 && (
                                                      <div className="mt-1 text-xs">
                                                        {/* Current price based on original required quantity */}
                                                        {priceAnalysis.currentPricePerUnit !== null && priceAnalysis.currentRange && (
                                                          <p>
                                                            Original Req. Price: <span className="font-semibold">${priceAnalysis.currentPricePerUnit.toFixed(2)}/unit</span>
                                                            (Qty: {priceAnalysis.currentRange.minQuantity}
                                                            {priceAnalysis.currentRange.maxQuantity ? `-${priceAnalysis.currentRange.maxQuantity}` : '+'})
                                                          </p>
                                                        )}
                                                        {/* Tip for next better price */}
                                                        {priceAnalysis.nextBetterRange && priceAnalysis.quantityToReachNextBetter !== null && priceAnalysis.nextBetterRange.price !== null && (
                                                          <p className="text-green-600 font-medium">
                                                            Tip: Order {priceAnalysis.nextBetterRange.minQuantity} (add {priceAnalysis.quantityToReachNextBetter}) for ${priceAnalysis.nextBetterRange.price.toFixed(2)}/unit.
                                                          </p>
                                                        )}
                                                        {/* Alternative if current quantity doesn't meet any range */}
                                                        {priceAnalysis.alternativeNextRange && !priceAnalysis.currentRange && priceAnalysis.alternativeNextRange.price !== null && (
                                                          <p className="text-blue-600">
                                                            Note: First available price is ${priceAnalysis.alternativeNextRange.price.toFixed(2)}/unit for {priceAnalysis.alternativeNextRange.minQuantity} units.
                                                          </p>
                                                        )}
                                                      </div>
                                                    )}
                                                    {link?.priceRanges && link.priceRanges.length > 0 && (
                                                        <div className="mt-3 space-y-1">
                                                        <p className="text-xs font-medium text-muted-foreground">Available Price Tiers for this supplier:</p>
                                                        <ul className="list-none pl-0 text-xs">
                                                            {link.priceRanges.map((range, rangeIdx) => {
                                                            const isRangeActive = applicableRangeForWatchedQty &&
                                                                range.minQuantity === applicableRangeForWatchedQty.minQuantity &&
                                                                range.maxQuantity === applicableRangeForWatchedQty.maxQuantity &&
                                                                range.price === applicableRangeForWatchedQty.price &&
                                                                range.priceType === applicableRangeForWatchedQty.priceType;
                                                            return (
                                                                <li
                                                                key={rangeIdx}
                                                                className={cn(
                                                                    "py-0.5 px-1.5 rounded-sm my-0.5",
                                                                    isRangeActive
                                                                    ? "bg-primary/20 text-primary-foreground font-semibold ring-1 ring-primary" // Adjusted for better contrast
                                                                    : "bg-muted/50"
                                                                )}
                                                                >
                                                                Qty: {range.minQuantity}{range.maxQuantity ? `-${range.maxQuantity}` : '+'}
                                                                {range.priceType === 'fixed' && range.price !== null ? ` - $${Number(range.price).toFixed(2)}/unit` : ` - ${range.priceType}`}
                                                                {range.additionalConditions && <span className="text-muted-foreground text-[10px]"> ({range.additionalConditions})</span>}
                                                                </li>
                                                            );
                                                            })}
                                                        </ul>
                                                        </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                          {/* Error message for this supplier's productsToQuote array (e.g. if empty after selection) */}
                                          {quoteRequestForm.formState.errors.suppliersToQuote?.[actualSupplierFormIndex]?.productsToQuote && (
                                            <ShadFormMessage className="mt-1 text-xs">
                                              {typeof quoteRequestForm.formState.errors.suppliersToQuote?.[actualSupplierFormIndex]?.productsToQuote?.message === 'string'
                                                ? quoteRequestForm.formState.errors.suppliersToQuote?.[actualSupplierFormIndex]?.productsToQuote?.message
                                                : "Error with product selection for this supplier." // Fallback message
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
                      {/* General error for suppliersToQuote array (e.g., less than 1 supplier selected) */}
                      {quoteRequestForm.formState.errors.suppliersToQuote && typeof quoteRequestForm.formState.errors.suppliersToQuote.message === 'string' && (
                        <ShadFormMessage className="pt-1 text-sm">
                          {quoteRequestForm.formState.errors.suppliersToQuote.message}
                        </ShadFormMessage>
                      )}
                      {/* Root error for suppliersToQuote (can come from superRefine if path is not specific enough) */}
                       {quoteRequestForm.formState.errors.suppliersToQuote?.root?.message && (
                        <ShadFormMessage className="pt-1 text-sm">
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
                              {field.value && isValid(field.value) ? format(field.value, "PPP") : <span>Pick a date</span>}
                              <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date < new Date(new Date().setDate(new Date().getDate() - 1))} initialFocus />
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

              <DialogFooter className="pt-4 flex-shrink-0 border-t"> {/* Added border-t for separation */}
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button
                  type="submit"
                  disabled={isSubmittingQuoteRequest || isLoadingSuppliers || isLoadingAllSupplierLinks || availableSuppliers.length === 0 || !requisition.requiredProducts || requisition.requiredProducts.length === 0 || !quoteRequestForm.formState.isValid}
                >
                  {isSubmittingQuoteRequest ? <Icons.Logo className="animate-spin mr-2 h-4 w-4" /> : <Icons.Send className="mr-2 h-4 w-4" />}
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