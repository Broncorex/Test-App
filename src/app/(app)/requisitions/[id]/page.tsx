
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
import type { Requisition, RequisitionStatus, RequiredProduct as RequisitionRequiredProductType, Supplier, ProveedorProducto, PriceRange } from "@/types";
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
import { useForm, useFieldArray, Controller, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAllSuppliers } from "@/services/supplierService";
import { createQuotation, type CreateQuotationRequestData } from "@/services/quotationService";
import { getSupplierProduct } from "@/services/supplierProductService";
import { getAllPurchaseOrders, getPurchaseOrderById } from "@/services/purchaseOrderService"; // Added
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { SupplierQuotationCard } from "@/components/requisitions/supplier-quotation-card";


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
  productsToQuote: z.array(quotedProductSchema).optional(),
});
type SupplierQuoteDetailFormData = z.infer<typeof supplierQuoteDetailSchema>;

const quotationRequestFormSchema = z.object({
  suppliersToQuote: z.array(supplierQuoteDetailSchema)
    .min(1, "At least one supplier must be selected for quotation.")
    .superRefine((suppliers, ctx) => {
      suppliers.forEach((supplierItem, index) => {
        if (!supplierItem.productsToQuote || supplierItem.productsToQuote.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Supplier "${supplierItem.supplierName}" must have at least one product selected to be included in the quote request.`,
            path: [`suppliersToQuote`, index, "productsToQuote"],
          });
        }
      });
    }),
  responseDeadline: z.date({ required_error: "Response deadline is required." }),
  notes: z.string().optional(),
});
export type QuotationRequestFormData = z.infer<typeof quotationRequestFormSchema>;


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

  const [pendingOrderedQuantities, setPendingOrderedQuantities] = useState<Record<string, number>>({});
  const [isLoadingPendingQuantities, setIsLoadingPendingQuantities] = useState(false);

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
    // If no range explicitly contains the quantity, check if it's below the lowest tier.
    // If so, no current range applies strictly, but the lowest tier is the "next available".
    // If it's above the highest tier (and that tier has a maxQuantity), then the highest tier might apply if it has no max or is the last defined.
    // This logic can be expanded if needed. For now, exact or within-range match.
    return null;
  }, []);
  
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
      const lowestTier = sortedRanges[0];
      if (lowestTier.price !== null) {
        result.alternativeNextRange = lowestTier;
      }
    } else if (result.currentPricePerUnit !== null) { 
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


  const fetchRequisitionData = useCallback(async () => {
    if (!requisitionId || !appUser) return;
    setIsLoading(true);
    setIsLoadingPendingQuantities(true);
    try {
      const fetchedRequisition = await getRequisitionById(requisitionId);
      if (fetchedRequisition) {
        if (role === 'employee' && fetchedRequisition.requestingUserId !== appUser.uid) {
          toast({ title: "Access Denied", description: "You do not have permission to view this requisition.", variant: "destructive" });
          router.replace("/requisitions");
          setIsLoading(false);
          setIsLoadingPendingQuantities(false);
          return;
        }
        setRequisition(fetchedRequisition);
        setSelectedStatus(fetchedRequisition.status);
        setEditableNotes(fetchedRequisition.notes || "");
        quoteRequestForm.reset({
          suppliersToQuote: [],
          responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          notes: fetchedRequisition.notes || "",
        });

        // Fetch and calculate pending ordered quantities
        const allPOsForRequisition = await getAllPurchaseOrders({ originRequisitionId: fetchedRequisition.id });
        const pendingPOs = allPOsForRequisition.filter(po => po.status === "Pending");
        const pendingQuantitiesMap: Record<string, number> = {};

        for (const pendingPOHeader of pendingPOs) {
          const fullPendingPO = await getPurchaseOrderById(pendingPOHeader.id); // This fetches details
          if (fullPendingPO && fullPendingPO.details) {
            fullPendingPO.details.forEach(detail => {
              pendingQuantitiesMap[detail.productId] = (pendingQuantitiesMap[detail.productId] || 0) + detail.orderedQuantity;
            });
          }
        }
        setPendingOrderedQuantities(pendingQuantitiesMap);

      } else {
        toast({ title: "Error", description: "Requisition not found.", variant: "destructive" });
        router.replace("/requisitions");
      }
    } catch (error) {
      console.error("Error fetching requisition details:", error);
      toast({ title: "Error", description: "Failed to fetch requisition details.", variant: "destructive" });
    } finally {
      setIsLoading(false);
      setIsLoadingPendingQuantities(false);
    }
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
            if (requisition.requiredProducts) {
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
        setAllSupplierProductLinks(prevLinks => ({ ...prevLinks, ...links }));
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


  const toggleSupplierForQuoting = useCallback((supplier: Supplier, isChecked: boolean) => {
    const supplierFieldArrayIndex = suppliersToQuoteFields.findIndex(sField => sField.supplierId === supplier.id);

    if (isChecked) {
      if (supplierFieldArrayIndex === -1) {
        appendSupplierToQuote({
          supplierId: supplier.id,
          supplierName: supplier.name,
          productsToQuote: undefined, 
        });
      }
    } else {
      if (supplierFieldArrayIndex !== -1) {
        removeSupplierFromQuote(supplierFieldArrayIndex);
      }
    }
    quoteRequestForm.trigger(`suppliersToQuote`);
  }, [appendSupplierToQuote, removeSupplierFromQuote, suppliersToQuoteFields, quoteRequestForm]);

  const handleToggleSupplierExpand = useCallback((supplierId: string) => {
    setExpandedSupplierProducts(prev => ({ ...prev, [supplierId]: !prev[supplierId] }));
  }, []);

  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser || !requisition.requiredProducts) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierQuote of data.suppliersToQuote) {
      if (!supplierQuote.productsToQuote || supplierQuote.productsToQuote.length === 0) {
        continue;
      }
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierQuote.supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
          productDetailsToRequest: supplierQuote.productsToQuote.map(qp => ({
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
      fetchRequisitionData();
    } else if (successCount > 0 && errorCount > 0) {
      toast({ title: "Partial Success", description: `${successCount} request(s) initiated, ${errorCount} failed.`, variant: "default" });
    } else if (errorCount > 0 && successCount === 0) {
      toast({ title: "All Requests Failed", description: "No quotation requests could be sent.", variant: "destructive" });
    } else if (successCount === 0 && errorCount === 0 && data.suppliersToQuote.length > 0) {
       toast({ title: "No Requests Sent", description: "Ensure products are selected for each chosen supplier.", variant: "default" });
    } else if (data.suppliersToQuote.length === 0) {
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
                            requisition.requestingUserId === currentUser?.uid &&
                            requisition.status === "Pending Quotation" &&
                            s !== "Canceled" &&
                            s !== "Pending Quotation"
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
              <ScrollArea className="h-[calc(100vh-20rem)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Required Qty</TableHead>
                      <TableHead className="text-right">Purchased Qty</TableHead>
                      <TableHead className="text-right">Pending Order Qty</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisition.requiredProducts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.requiredQuantity}</TableCell>
                        <TableCell className="text-right">{item.purchasedQuantity || 0}</TableCell>
                        <TableCell className="text-right">
                           {isLoadingPendingQuantities ? <Skeleton className="h-5 w-10 inline-block" /> : (pendingOrderedQuantities[item.productId] || 0)}
                        </TableCell>
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
                  Select suppliers, choose products and set quoted quantities for each, and set a response deadline for requisition: {requisition.id.substring(0, 8)}...
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
                          Select suppliers, then expand to choose products and set quoted quantities for each.
                        </p>
                      </div>
                      {isLoadingSuppliers ? <p>Loading suppliers...</p> :
                        availableSuppliers.length === 0 ? <p>No active suppliers found.</p> :
                          <ScrollArea className="h-[calc(100vh-28rem)] md:h-72 rounded-md border p-1">
                            {availableSuppliers.map((supplier, supplierFormIndex) => {
                              const isSupplierSelectedForQuoting = suppliersToQuoteFields.some(sField => sField.supplierId === supplier.id);
                               const actualSupplierFormIndex = suppliersToQuoteFields.findIndex(sField => sField.supplierId === supplier.id);

                              return (
                                <SupplierQuotationCard
                                  key={supplier.id}
                                  supplier={supplier}
                                  requisitionRequiredProducts={requisition.requiredProducts || []}
                                  supplierAnalysisData={supplierAnalysisData}
                                  formInstance={quoteRequestForm}
                                  supplierFormIndex={actualSupplierFormIndex} 
                                  isSupplierSelected={isSupplierSelectedForQuoting}
                                  onToggleSupplier={toggleSupplierForQuoting}
                                  isExpanded={!!expandedSupplierProducts[supplier.id]}
                                  onToggleExpand={handleToggleSupplierExpand}
                                  isLoadingAllSupplierLinks={isLoadingAllSupplierLinks}
                                  getApplicablePriceRange={getApplicablePriceRange}
                                  memoizedAnalyzePriceRanges={memoizedAnalyzePriceRanges}
                                />
                              );
                            })}
                          </ScrollArea>
                      }
                      {quoteRequestForm.formState.errors.suppliersToQuote && typeof quoteRequestForm.formState.errors.suppliersToQuote.message === 'string' && (
                        <ShadFormMessage className="pt-1 text-sm">
                          {quoteRequestForm.formState.errors.suppliersToQuote.message}
                        </ShadFormMessage>
                      )}
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

              <DialogFooter className="pt-4 flex-shrink-0 border-t">
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

    
