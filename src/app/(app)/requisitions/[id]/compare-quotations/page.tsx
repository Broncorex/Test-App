
// src/app/(app)/requisitions/[id]/compare-quotations/page.tsx
"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type {
  Quotation,
  QuotationStatus,
  QuotationDetail,
  Requisition,
  RequiredProduct as RequisitionRequiredProduct,
  QuotationAdditionalCost,
} from "@/types";
import {
  getAllQuotations,
  getQuotationById,
} from "@/services/quotationService";
import {
  getRequisitionById,
  processAndFinalizeAwards,
} from "@/services/requisitionService";
import { useAuth } from "@/hooks/use-auth-store";
import { useToast } from "@/hooks/use-toast";
import { format, isValid, differenceInCalendarDays } from "date-fns";
import { Timestamp } from "firebase/firestore";
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


interface QuotationOffer extends QuotationDetail {
  quotationId: string;
  supplierName: string;
  supplierId: string;
  overallQuotationStatus: QuotationStatus;
  quotationTotal: number;
  quotationAdditionalCosts?: QuotationAdditionalCost[];
  // estimatedDeliveryDate is already part of QuotationDetail from types/index.ts
}

interface ProductToCompare extends RequisitionRequiredProduct {
  requisitionProductId: string;
  offers: QuotationOffer[];
  alreadyPurchased: number; 
  pendingPOQuantity: number; 
  remainingToAward: number; 
}

export interface SelectedOfferInfo {
  quotationId: string;
  quotationDetailId: string;
  supplierName: string;
  supplierId: string;
  productId: string;
  productName: string;
  awardedQuantity: number;
  unitPrice: number;
  estimatedDeliveryDate: Timestamp;
}

const formatTimestampDate = (timestamp?: Timestamp | null): string => {
  if (!timestamp) return "N/A";
  let date: Date;
  if (timestamp instanceof Timestamp) {
    date = timestamp.toDate();
  } else if (typeof timestamp === "string") {
    date = new Date(timestamp);
  } else {
    return "Invalid Date Object";
  }
  return isValid(date) ? format(date, "PPP") : "Invalid Date";
};

export default function CompareQuotationsPage() {
  const pathParams = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const requisitionId = pathParams.id as string;
  const currentQuoteIdFromParams = searchParams.get("currentQuoteId");

  const { toast } = useToast();
  const { currentUser, role } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [productsForComparison, setProductsForComparison] = useState<ProductToCompare[]>([]);
  const [relevantQuotesWithDetails, setRelevantQuotesWithDetails] = useState<Quotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingAwards, setIsSubmittingAwards] = useState(false);

  const [selectedOffers, setSelectedOffers] = useState<Record<string, SelectedOfferInfo | null>>({});
  const [maxDeliveryDays, setMaxDeliveryDays] = useState<string>("");
  const [isCalculatingCombination, setIsCalculatingCombination] = useState(false);

  const [isOverOrderConfirmOpen, setIsOverOrderConfirmOpen] = useState(false);
  const [overOrderDetails, setOverOrderDetails] = useState<{ productName: string; overBy: number; originalReq: number; potentialTotal: number }[]>([]);


  const fetchComparisonData = useCallback(async () => {
    if (!requisitionId) {
      setIsLoading(false);
      toast({ title: "Error", description: "Requisition ID is missing.", variant: "destructive" });
      router.replace("/requisitions");
      return;
    }
    setIsLoading(true);
    setSelectedOffers({});
    setRelevantQuotesWithDetails([]);

    try {
      const fetchedRequisition = await getRequisitionById(requisitionId);
      if (!fetchedRequisition || !fetchedRequisition.requiredProducts) {
        toast({ title: "Error", description: "Requisition or its products not found.", variant: "destructive" });
        setRequisition(null);
        setProductsForComparison([]);
        setIsLoading(false);
        return;
      }
      setRequisition(fetchedRequisition);

      const allQuotesForRequisition = await getAllQuotations({ requisitionId });
      const detailedRelevantQuotesPromises = allQuotesForRequisition
        .filter((quoteHeader) =>
          ["Received", "Partially Awarded", "Awarded"].includes(quoteHeader.status)
        )
        .map((quoteHeader) => getQuotationById(quoteHeader.id));

      const validDetailedQuotes = (await Promise.all(detailedRelevantQuotesPromises)).filter(q => q !== null) as Quotation[];
      setRelevantQuotesWithDetails(validDetailedQuotes);

      const productsToCompareMap = new Map<string, ProductToCompare>();
      fetchedRequisition.requiredProducts.forEach((reqProduct) => {
        const alreadyPurchased = reqProduct.purchasedQuantity || 0;
        const pendingPO = reqProduct.pendingPOQuantity || 0;
        productsToCompareMap.set(reqProduct.productId, {
          ...reqProduct,
          requisitionProductId: reqProduct.id,
          offers: [],
          alreadyPurchased: alreadyPurchased,
          pendingPOQuantity: pendingPO,
          remainingToAward: Math.max(0, reqProduct.requiredQuantity - (alreadyPurchased + pendingPO)),
        });
      });

      validDetailedQuotes.forEach((quote) => {
        quote.quotationDetails?.forEach((detail) => {
          const productEntry = productsToCompareMap.get(detail.productId);
          if (productEntry) {
            productEntry.offers.push({
              ...detail,
              quotationId: quote.id,
              supplierName: quote.supplierName || "Unknown Supplier",
              supplierId: quote.supplierId,
              overallQuotationStatus: quote.status,
              quotationTotal: quote.totalQuotation || 0,
              quotationAdditionalCosts: quote.additionalCosts || [],
            });
          }
        });
      });
      setProductsForComparison(Array.from(productsToCompareMap.values()));
    } catch (error) {
      console.error("Error fetching data for comparison:", error);
      toast({ title: "Error", description: "Could not load data for comparison.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [requisitionId, toast, router]);

  useEffect(() => {
    fetchComparisonData();
  }, [fetchComparisonData]);

  const handleOfferSelection = (
    requisitionProductId: string,
    clickedOfferDetailId: string | null
  ) => {
    setSelectedOffers((prevSelectedOffers) => {
      const updated = { ...prevSelectedOffers };
      const productBeingAwarded = productsForComparison.find((p) => p.requisitionProductId === requisitionProductId);
      if (!productBeingAwarded) return prevSelectedOffers;

      if (clickedOfferDetailId === null) { 
        updated[requisitionProductId] = null;
        return updated;
      }

      const offer = productBeingAwarded.offers.find(o => o.id === clickedOfferDetailId);

      if (offer) {
        if (offer.quotedQuantity <= 0) {
          toast({
            title: "Cannot Select Offer",
            description: "This offer has zero quoted quantity from the supplier.",
            variant: "default",
          });
          return prevSelectedOffers;
        }
        
        updated[requisitionProductId] = {
          quotationId: offer.quotationId,
          quotationDetailId: offer.id,
          supplierName: offer.supplierName,
          supplierId: offer.supplierId,
          productId: offer.productId,
          productName: offer.productName,
          awardedQuantity: offer.quotedQuantity, 
          unitPrice: offer.unitPriceQuoted,
          estimatedDeliveryDate: offer.estimatedDeliveryDate || Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), 
        };
      } else {
        updated[requisitionProductId] = null;
      }
      return updated;
    });
  };

  const awardSummaryDetails = useMemo(() => {
    let productsSubtotal = 0;
    const awardedItems: SelectedOfferInfo[] = [];
    const uniqueAwardedQuotationInfo: Record<
      string,
      {
        supplierName: string;
        additionalCosts: QuotationAdditionalCost[];
        totalOriginalQuote: number;
      }
    > = {};

    Object.values(selectedOffers).forEach((offerInfo) => {
      if (offerInfo) {
        productsSubtotal += offerInfo.awardedQuantity * offerInfo.unitPrice;
        awardedItems.push(offerInfo);
        if (!uniqueAwardedQuotationInfo[offerInfo.quotationId]) {
          const originalQuote = relevantQuotesWithDetails.find(
            (q) => q.id === offerInfo.quotationId
          );
          uniqueAwardedQuotationInfo[offerInfo.quotationId] = {
            supplierName: offerInfo.supplierName,
            additionalCosts: originalQuote?.additionalCosts || [],
            totalOriginalQuote: originalQuote?.totalQuotation || 0,
          };
        }
      }
    });

    let totalAdditionalCosts = 0;
    Object.values(uniqueAwardedQuotationInfo).forEach((info) => {
      info.additionalCosts.forEach((cost) => {
        totalAdditionalCosts += Number(cost.amount);
      });
    });
    const grandTotal = productsSubtotal + totalAdditionalCosts;
    return { awardedItems, productsSubtotal, uniqueAwardedQuotationInfo, totalAdditionalCosts, grandTotal };
  }, [selectedOffers, relevantQuotesWithDetails]);

 const handleCalculateOptimalCombination = () => {
    setIsCalculatingCombination(true);
    const deliveryDaysConstraint = maxDeliveryDays ? parseInt(maxDeliveryDays, 10) : null;

    if (deliveryDaysConstraint !== null && (isNaN(deliveryDaysConstraint) || deliveryDaysConstraint < 0) ) {
        toast({ title: "Invalid Input", description: "Max Delivery Days must be a non-negative number.", variant: "destructive" });
        setIsCalculatingCombination(false);
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let allProductsAttemptedForFulfillment = true;
    const newSelectedOffers: Record<string, SelectedOfferInfo | null> = {};

    for (const product of productsForComparison) {
        if (product.remainingToAward <= 0 && !Object.values(selectedOffers).some(so => so?.productId === product.productId && so.awardedQuantity > 0)) {
            newSelectedOffers[product.requisitionProductId] = selectedOffers[product.requisitionProductId] || null;
            continue;
        }

        const validOffersForProduct = product.offers.filter(offer => {
            if (offer.quotedQuantity <= 0) return false;
            if (deliveryDaysConstraint !== null) {
                if (!offer.estimatedDeliveryDate) return false;
                const deliveryDate = offer.estimatedDeliveryDate.toDate();
                deliveryDate.setHours(0,0,0,0);
                if (!isValid(deliveryDate)) return false;
                const daysToDelivery = differenceInCalendarDays(deliveryDate, today);
                return daysToDelivery <= deliveryDaysConstraint && daysToDelivery >= 0;
            }
            return true;
        });

        if (validOffersForProduct.length === 0) {
            allProductsAttemptedForFulfillment = false;
            newSelectedOffers[product.requisitionProductId] = null;
            if (product.remainingToAward > 0) {
                 toast({
                    title: "Calculation Issue",
                    description: `No valid offers found for ${product.productName} within the ETA constraint or with sufficient quantity.`,
                    variant: "default"
                });
            }
            continue;
        }

        let bestOfferForProduct: QuotationOffer | null = null;
        const sortedValidOffers = [...validOffersForProduct].sort((a,b) => {
            const a_meets_req = a.quotedQuantity >= product.remainingToAward;
            const b_meets_req = b.quotedQuantity >= product.remainingToAward;
            if (a_meets_req && !b_meets_req) return -1;
            if (!a_meets_req && b_meets_req) return 1;
            if (a.unitPriceQuoted !== b.unitPriceQuoted) return a.unitPriceQuoted - b.unitPriceQuoted;
            const etaA = a.estimatedDeliveryDate?.toMillis() || Infinity;
            const etaB = b.estimatedDeliveryDate?.toMillis() || Infinity;
            return etaA - etaB;
        });
        bestOfferForProduct = sortedValidOffers[0] || null;

        if (bestOfferForProduct) {
            const quantityToOrderFromOffer = bestOfferForProduct.quotedQuantity;
            if (product.remainingToAward > 0 && quantityToOrderFromOffer < product.remainingToAward) {
                allProductsAttemptedForFulfillment = false;
                toast({
                    title: "Optimal Combination: Partial Fulfillment",
                    description: `Best offer for ${product.productName} from ${bestOfferForProduct.supplierName} is for ${quantityToOrderFromOffer} units, but ${product.remainingToAward} are still needed for the requisition.`,
                    variant: "default",
                    duration: 7000
                });
            }
            newSelectedOffers[product.requisitionProductId] = {
                quotationId: bestOfferForProduct.quotationId,
                quotationDetailId: bestOfferForProduct.id,
                supplierName: bestOfferForProduct.supplierName,
                supplierId: bestOfferForProduct.supplierId,
                productId: bestOfferForProduct.productId,
                productName: bestOfferForProduct.productName,
                awardedQuantity: quantityToOrderFromOffer,
                unitPrice: bestOfferForProduct.unitPriceQuoted,
                estimatedDeliveryDate: bestOfferForProduct.estimatedDeliveryDate || Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
            };
        } else {
             if (product.remainingToAward > 0) allProductsAttemptedForFulfillment = false;
            newSelectedOffers[product.requisitionProductId] = null;
        }
    }
    setSelectedOffers(newSelectedOffers);

    if (!allProductsAttemptedForFulfillment && productsForComparison.some(p => p.remainingToAward > 0 && !newSelectedOffers[p.requisitionProductId])) {
        toast({
            title: "Optimal Combination Notice",
            description: "Could not fully satisfy all *pending* product requirements with current offers/constraints. Review selections.",
            variant: "default",
            duration: 7000,
        });
    } else {
        let allOriginalRequirementsMetOrExceeded = true;
        for (const product of productsForComparison) {
            const selectedAward = newSelectedOffers[product.requisitionProductId];
            const totalAwardedForProduct = selectedAward ? selectedAward.awardedQuantity : 0;
            const totalCommitted = totalAwardedForProduct + (product.pendingPOQuantity || 0) + product.alreadyPurchased;
            if (totalCommitted < product.requiredQuantity) {
                allOriginalRequirementsMetOrExceeded = false;
                break;
            }
        }
        if (allOriginalRequirementsMetOrExceeded) {
             toast({
                title: "Optimal Combination Calculated",
                description: "Selections updated. Original requisition quantities appear to be met or exceeded by this combination (including existing commitments).",
                variant: "default",
            });
        } else {
            toast({
                title: "Optimal Combination Calculated (May Be Partial)",
                description: "Selections updated. Some original requisition quantities might not be fully covered even with new selections. Please review.",
                variant: "default",
                duration: 7000,
            });
        }
    }
    setIsCalculatingCombination(false);
  };

  const proceedWithFinalizingAwards = async () => {
    setIsOverOrderConfirmOpen(false); 
    setOverOrderDetails([]);
    const awardsToProcess = Object.values(selectedOffers).filter((offer) => offer !== null) as SelectedOfferInfo[];
    
    setIsSubmittingAwards(true);
    try {
      const result = await processAndFinalizeAwards(requisitionId, awardsToProcess, relevantQuotesWithDetails, currentUser!.uid);
      if (result.success) {
        toast({
          title: "Awards Processed & POs Created!",
          description: result.message || `Requisition status updated. ${result.createdPurchaseOrderIds?.length || 0} Purchase Order(s) created with 'Pending' status.`,
          variant: "default",
          duration: 7000,
        });
        if (result.createdPurchaseOrderIds && result.createdPurchaseOrderIds.length > 0) {
            router.push('/purchase-orders');
        } else {
            fetchComparisonData(); 
        }
      } else {
        toast({ title: "Finalization Failed", description: result.message || "Could not process awards or create POs.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error("Error finalizing awards:", error);
      toast({ title: "Error", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsSubmittingAwards(false);
    }
  };

  const handleFinalizeAwards = async () => {
    const awardsToProcess = Object.values(selectedOffers).filter((offer) => offer !== null) as SelectedOfferInfo[];
    
    const netRemainingNeededForAnyProduct = productsForComparison.some(p => p.remainingToAward > 0);
    if (awardsToProcess.length === 0 && netRemainingNeededForAnyProduct) {
      toast({ title: "No Selections", description: "Please select offers for items that still need to be ordered, or ensure all requirements are met.", variant: "default" });
      return;
    }
    
    if (!currentUser || (role !== "admin" && role !== "superadmin")) {
      toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive" });
      return;
    }

    const currentOverOrderItems: { productName: string; overBy: number; originalReq: number; potentialTotal: number }[] = [];
    for (const product of productsForComparison) {
      const selectedAward = selectedOffers[product.requisitionProductId];
      const awardedQtyForThisProduct = selectedAward ? selectedAward.awardedQuantity : 0;
      
      if (awardedQtyForThisProduct === 0) continue; 

      const potentialTotalCommittedQuantity = awardedQtyForThisProduct + (product.pendingPOQuantity || 0) + product.alreadyPurchased;

      if (potentialTotalCommittedQuantity > product.requiredQuantity) {
        currentOverOrderItems.push({
          productName: product.productName,
          overBy: potentialTotalCommittedQuantity - product.requiredQuantity,
          originalReq: product.requiredQuantity,
          potentialTotal: potentialTotalCommittedQuantity,
        });
      }
    }

    if (currentOverOrderItems.length > 0) {
      setOverOrderDetails(currentOverOrderItems);
      setIsOverOrderConfirmOpen(true);
      return; 
    }
    await proceedWithFinalizingAwards();
  };

  if (isLoading) {
    return (
      <>
        <PageHeader
          title="Compare Quotations"
          description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "Loading..."}`}
          actions={<Button onClick={() => router.back()} variant="outline">Back</Button>}
        />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </>
    );
  }

  if (!requisition) {
    return (
      <>
        <PageHeader title="Compare Quotations" description="Error loading requisition." actions={<Button onClick={() => router.back()} variant="outline">Back</Button>} />
        <p className="text-center text-muted-foreground py-8">Could not load requisition details.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Compare Quotations"
        description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "N/A"} (Status: ${requisition.status})`}
        actions={<Button onClick={() => router.back()} variant="outline">Back</Button>}
      />

      <Card className="mb-6 shadow-md">
          <CardHeader><CardTitle className="font-headline text-lg">Optimization Tools</CardTitle></CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-end gap-4">
              <div className="flex-grow space-y-1">
                  <Label htmlFor="maxDeliveryDays">Max Delivery Days ETA (Optional)</Label>
                  <Input id="maxDeliveryDays" type="number" placeholder="e.g., 7 for one week" value={maxDeliveryDays} onChange={(e) => setMaxDeliveryDays(e.target.value)} min="0"/>
              </div>
              <Button onClick={handleCalculateOptimalCombination} disabled={isCalculatingCombination || productsForComparison.length === 0} className="w-full sm:w-auto">
                  {isCalculatingCombination ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.DollarSign className="mr-2 h-4 w-4" />}
                  Calculate Lowest Cost
              </Button>
          </CardContent>
      </Card>

      {productsForComparison.length === 0 ? (
        <Card><CardHeader><CardTitle>No Quotation Offers Found</CardTitle></CardHeader><CardContent><p>No relevant quotation offers found for products in this requisition.</p></CardContent></Card>
      ) : (
        <div className="space-y-6">
          {productsForComparison.map((product) => {
            const netRemainingToAward = product.remainingToAward;
            return (
              <Card key={product.requisitionProductId} className="shadow-md">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="font-headline text-xl">{product.productName}</CardTitle>
                      <CardDescription>
                        Required: {product.requiredQuantity} | Ordered: {product.alreadyPurchased} | Pending PO: {product.pendingPOQuantity || 0} |
                        <span className={cn("font-semibold", netRemainingToAward <= 0 ? "text-green-600" : "text-orange-600")}>
                          {""} Net Remaining: {netRemainingToAward}
                        </span>
                      </CardDescription>
                    </div>
                    {netRemainingToAward <= 0 && (<Badge variant="default" className="bg-green-500 text-white">Requirement Met/Exceeded</Badge>)}
                  </div>
                </CardHeader>
                <CardContent>
                  {product.offers.length > 0 ? (
                    <RadioGroup
                      value={selectedOffers[product.requisitionProductId]?.quotationDetailId || ""}
                      onValueChange={(value) => {
                        handleOfferSelection(product.requisitionProductId, value);
                      }}
                    >
                      <div className="relative w-full overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Supplier</TableHead>
                              <TableHead className="text-right">Offered Qty</TableHead>
                              <TableHead className="text-right">Unit Price</TableHead>
                              <TableHead className="text-right">Line Total (for Offered Qty)</TableHead>
                              <TableHead>Delivery ETA</TableHead>
                              <TableHead className="max-w-[100px]">Conditions</TableHead>
                              <TableHead className="text-center">Quote</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {product.offers.map((offer) => {
                              const isSelected = selectedOffers[product.requisitionProductId]?.quotationDetailId === offer.id;
                              const offeredQty = offer.quotedQuantity;
                              const canSelectOffer = offeredQty > 0;
                              return (
                                <TableRow key={offer.id} className={cn(isSelected && "bg-primary/10", currentQuoteIdFromParams === offer.quotationId && !isSelected && "bg-blue-50")}>
                                  <TableCell>
                                    <RadioGroupItem value={offer.id} id={`${product.requisitionProductId}-${offer.id}`} disabled={!canSelectOffer}/>
                                  </TableCell>
                                  <TableCell className="font-medium">{offer.supplierName}</TableCell>
                                  <TableCell className="text-right">{offeredQty}</TableCell>
                                  <TableCell className="text-right">${Number(offer.unitPriceQuoted).toFixed(2)}</TableCell>
                                  <TableCell className="text-right font-semibold">${(offeredQty * Number(offer.unitPriceQuoted)).toFixed(2)}</TableCell>
                                  <TableCell>{formatTimestampDate(offer.estimatedDeliveryDate)}</TableCell>
                                  <TableCell className="text-xs max-w-[150px] truncate" title={offer.conditions || undefined}>{offer.conditions || "N/A"}</TableCell>
                                  <TableCell className="text-center">
                                    <Button variant="ghost" size="icon" asChild title={`View Quotation ${offer.quotationId.substring(0,6)}...`}>
                                      <Link href={`/quotations/${offer.quotationId}`} target="_blank" rel="noopener noreferrer">
                                        <Icons.View className="h-4 w-4" />
                                      </Link>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </RadioGroup>
                  ) : (
                    <p className="text-sm text-muted-foreground">No supplier offers received for this product yet.</p>
                  )}
                </CardContent>
                 {product.offers.length > 0 && (
                   <CardFooter className="pt-2 border-t">
                      <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOfferSelection(product.requisitionProductId, null)}
                          disabled={!selectedOffers[product.requisitionProductId]}
                      >
                          <Icons.Delete className="mr-2 h-3 w-3" /> Clear Selection for {product.productName}
                      </Button>
                   </CardFooter>
                  )}
              </Card>
            );
          })}

          {awardSummaryDetails.awardedItems.length > 0 && (
            <Card className="mt-6 shadow-lg">
              <CardHeader>
                <CardTitle className="font-headline">Award Summary & PO Creation</CardTitle>
                <CardDescription>Review selections. Clicking "Finalize" will create Purchase Order(s) with 'Pending' status. The actual quantity ordered will be the supplier's quoted quantity for the selected offer.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative w-full overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Awarded Supplier</TableHead>
                        <TableHead className="text-right">To Order Qty (from Quote)</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Subtotal Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {awardSummaryDetails.awardedItems.map((selection) => (
                        <TableRow key={`${selection.productId}-${selection.supplierId}`}>
                          <TableCell>{selection.productName}</TableCell>
                          <TableCell>{selection.supplierName}</TableCell>
                          <TableCell className="text-right">{selection.awardedQuantity}</TableCell>
                          <TableCell className="text-right">${selection.unitPrice.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold">${(selection.awardedQuantity * selection.unitPrice).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Separator className="my-4" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Products Subtotal:</span>
                    <span className="font-medium">${awardSummaryDetails.productsSubtotal.toFixed(2)}</span>
                  </div>
                  {Object.entries(awardSummaryDetails.uniqueAwardedQuotationInfo).map(
                    ([quoteId, info]) => info.additionalCosts.length > 0 && (
                      <React.Fragment key={quoteId}>
                        <p className="font-medium mt-1 text-muted-foreground">{info.supplierName} - Additional Costs:</p>
                        {info.additionalCosts.map((cost, index) => (
                          <div key={`${quoteId}-${index}`} className="flex justify-between pl-2">
                            <span>{cost.description} ({cost.type}):</span>
                            <span className="font-medium">${Number(cost.amount).toFixed(2)}</span>
                          </div>
                        ))}
                      </React.Fragment>
                    )
                  )}
                </div>
                <Separator className="my-4" />
                <div className="mt-4 text-right">
                  <p className="text-lg font-bold">Total Estimated Cost for PO(s): ${awardSummaryDetails.grandTotal.toFixed(2)}</p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end">
                <Button 
                  size="lg" 
                  onClick={handleFinalizeAwards} 
                  disabled={isSubmittingAwards || isLoading || (awardSummaryDetails.awardedItems.length === 0 && productsForComparison.some(p => p.remainingToAward > 0))}
                >
                  {isSubmittingAwards ? <Icons.Logo className="mr-2 h-5 w-5 animate-spin" /> : <Icons.ShoppingCart className="mr-2 h-5 w-5" />}
                  {isSubmittingAwards ? "Processing..." : "Create Pending PO(s)"}
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}

      <AlertDialog open={isOverOrderConfirmOpen} onOpenChange={setIsOverOrderConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Over-Ordering</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">
            <p>
              You are about to create Purchase Orders that may result in ordering more than originally requisitioned (considering existing pending POs and already purchased quantities) for the following items:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              {overOrderDetails.map(detail => (
                <li key={detail.productName}>
                  <strong>{detail.productName}</strong>: Original Req: {detail.originalReq}, Potential Total Committed: {detail.potentialTotal} (Over by {detail.overBy})
                </li>
              ))}
            </ul>
            <p className="mt-2">
              This action will proceed to create Purchase Order(s) with the selected quantities. Are you sure you want to continue?
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setIsOverOrderConfirmOpen(false); setOverOrderDetails([]); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={proceedWithFinalizingAwards}>
              Confirm & Create PO(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
    
