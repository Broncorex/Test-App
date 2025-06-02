
"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { Quotation, QuotationStatus, QuotationDetail, Requisition, RequiredProduct as RequisitionRequiredProduct, QuotationAdditionalCost } from "@/types";
import { getAllQuotations, getQuotationById } from "@/services/quotationService";
import { getRequisitionById, processAndFinalizeAwards } from "@/services/requisitionService";
import { useAuth } from "@/hooks/use-auth-store";
import { useToast } from "@/hooks/use-toast";
import { format, isValid } from "date-fns";
import { Timestamp } from "firebase/firestore";
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";


interface QuotationOffer extends QuotationDetail {
  quotationId: string;
  supplierName: string;
  supplierId: string;
  overallQuotationStatus: QuotationStatus;
  quotationTotal: number; // Original total of the quotation this offer came from
  quotationAdditionalCosts?: QuotationAdditionalCost[]; // Original additional costs
}

interface ProductToCompare extends RequisitionRequiredProduct {
  requisitionProductId: string; 
  offers: QuotationOffer[];
  alreadyPurchased: number;
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
}

const formatTimestampDate = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    let date: Date;
    if (timestamp instanceof Timestamp) {
      date = timestamp.toDate();
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return "Invalid Date Object";
    }
    return isValid(date) ? format(date, "PPP") : "Invalid Date";
};

export default function CompareQuotationsPage() {
  const params = useParams();
  const router = useRouter();
  
  const requisitionId = params.id as string;
  const currentQuoteIdFromParams = useSearchParams().get("currentQuoteId");

  console.log("DEBUG: CompareQuotationsPage rendered for requisitionId (params.id):", requisitionId);
  const { toast } = useToast();
  const { currentUser, role } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [productsForComparison, setProductsForComparison] = useState<ProductToCompare[]>([]);
  const [relevantQuotesWithDetails, setRelevantQuotesWithDetails] = useState<Quotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingAwards, setIsSubmittingAwards] = useState(false);

  const [selectedOffers, setSelectedOffers] = useState<Record<string, SelectedOfferInfo | null>>({}); // Key: requisitionProductId


  const fetchComparisonData = useCallback(async () => {
    if (!requisitionId) {
      setIsLoading(false);
      toast({ title: "Error", description: "Requisition ID is missing.", variant: "destructive" });
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
      
      const detailedRelevantQuotes: Quotation[] = [];
      for (const quoteHeader of allQuotesForRequisition) {
        if (["Received", "Partially Awarded", "Awarded"].includes(quoteHeader.status)) {
          const detailedQuote = await getQuotationById(quoteHeader.id); 
          if (detailedQuote) {
            detailedRelevantQuotes.push(detailedQuote);
          }
        }
      }
      setRelevantQuotesWithDetails(detailedRelevantQuotes);
      
      const productsToCompareMap = new Map<string, ProductToCompare>();

      fetchedRequisition.requiredProducts.forEach(reqProduct => {
        productsToCompareMap.set(reqProduct.productId, { 
          ...reqProduct,
          requisitionProductId: reqProduct.id, 
          offers: [],
          alreadyPurchased: reqProduct.purchasedQuantity || 0,
          remainingToAward: reqProduct.requiredQuantity - (reqProduct.purchasedQuantity || 0)
        });
      });

      detailedRelevantQuotes.forEach(quote => {
        quote.quotationDetails?.forEach(detail => {
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
  }, [requisitionId, toast]);

  useEffect(() => {
    fetchComparisonData();
  }, [fetchComparisonData]);

  const handleOfferSelection = (requisitionProductId: string, offer: QuotationOffer | null) => {
    setSelectedOffers(prev => {
      const updated = { ...prev };
      if (offer) {
        const productBeingAwarded = productsForComparison.find(p => p.requisitionProductId === requisitionProductId);
        if (!productBeingAwarded) return prev;

        const remainingToAward = productBeingAwarded.requiredQuantity - productBeingAwarded.alreadyPurchased;
        const quantityToAwardThisTime = Math.min(remainingToAward, offer.quotedQuantity);
        
        if (quantityToAwardThisTime <= 0 && remainingToAward > 0) { 
            toast({ title: "Cannot Select", description: "This offer has zero quantity or required quantity already met by other means.", variant: "default"});
            updated[requisitionProductId] = null; 
        } else if (quantityToAwardThisTime <= 0 && remainingToAward <= 0) {
             updated[requisitionProductId] = null; // Requirement met, clear selection
        }
        else {
            updated[requisitionProductId] = {
                quotationId: offer.quotationId,
                quotationDetailId: offer.id, 
                supplierName: offer.supplierName,
                supplierId: offer.supplierId,
                productId: offer.productId,
                productName: offer.productName,
                awardedQuantity: quantityToAwardThisTime,
                unitPrice: offer.unitPriceQuoted,
            };
        }
      } else {
        updated[requisitionProductId] = null; 
      }
      return updated;
    });
  };

  const awardSummaryDetails = useMemo(() => {
    let productsSubtotal = 0;
    const awardedItems: SelectedOfferInfo[] = [];
    const uniqueAwardedQuotationInfo: Record<string, { supplierName: string, additionalCosts: QuotationAdditionalCost[], totalOriginalQuote: number }> = {};

    Object.values(selectedOffers).forEach(offer => {
      if (offer) {
        productsSubtotal += offer.awardedQuantity * offer.unitPrice;
        awardedItems.push(offer);
        if (!uniqueAwardedQuotationInfo[offer.quotationId]) {
          const originalQuote = relevantQuotesWithDetails.find(q => q.id === offer.quotationId);
          uniqueAwardedQuotationInfo[offer.quotationId] = {
            supplierName: offer.supplierName,
            additionalCosts: originalQuote?.additionalCosts || [],
            totalOriginalQuote: originalQuote?.totalQuotation || 0,
          };
        }
      }
    });

    let totalAdditionalCosts = 0;
    Object.values(uniqueAwardedQuotationInfo).forEach(info => {
      info.additionalCosts.forEach(cost => {
        totalAdditionalCosts += Number(cost.amount);
      });
    });
    
    const grandTotal = productsSubtotal + totalAdditionalCosts;

    return {
      awardedItems,
      productsSubtotal,
      uniqueAwardedQuotationInfo,
      totalAdditionalCosts,
      grandTotal,
    };
  }, [selectedOffers, relevantQuotesWithDetails]);


  const handleFinalizeAwards = async () => {
    const awardsToProcess = Object.values(selectedOffers).filter(offer => offer !== null) as SelectedOfferInfo[];

    if (awardsToProcess.length === 0) {
        toast({ title: "No Selections", description: "Please select at least one offer to award.", variant: "default" });
        return;
    }
    if (!currentUser || (role !== 'admin' && role !== 'superadmin')) {
        toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive"});
        return;
    }
    
    setIsSubmittingAwards(true);
    try {
        const result = await processAndFinalizeAwards(requisitionId, awardsToProcess, currentUser.uid);
        if (result.success) {
            toast({ title: "Awards Finalized Successfully!", description: "Requisition and quotation statuses have been updated.", variant: "default"});
            fetchComparisonData(); 
        } else {
            toast({ title: "Finalization Failed", description: result.message || "Could not process awards.", variant: "destructive" });
        }
    } catch (error: any) {
        console.error("Error finalizing awards:", error);
        toast({ title: "Error", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {
        setIsSubmittingAwards(false);
    }
  };


  if (isLoading) {
    return (
      <>
        <PageHeader title="Compare Quotations" description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "Loading..."}`} actions={<Button onClick={() => router.back()} variant="outline">Back</Button>} />
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
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
        title={`Compare Quotations`}
        description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "N/A"} (Status: ${requisition.status})`}
        actions={<Button onClick={() => router.back()} variant="outline">Back</Button>}
      />
      
      {productsForComparison.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>No Quotation Offers Found</CardTitle></CardHeader>
          <CardContent><p>No relevant quotation offers (Received, Awarded, etc.) found for the products in this requisition.</p></CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {productsForComparison.map((product) => {
            const remainingToAwardForProduct = product.requiredQuantity - product.alreadyPurchased;
            return (
              <Card key={product.requisitionProductId} className="shadow-md">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="font-headline text-xl">{product.productName}</CardTitle>
                      <CardDescription>
                        Required: {product.requiredQuantity} | 
                        Purchased/Awarded: {product.alreadyPurchased} | 
                        <span className={cn("font-semibold", remainingToAwardForProduct <= 0 ? "text-green-600" : "text-orange-600")}>
                          {""} Remaining to Award: {remainingToAwardForProduct > 0 ? remainingToAwardForProduct : 0}
                        </span>
                      </CardDescription>
                    </div>
                    {remainingToAwardForProduct <= 0 && <Badge variant="default" className="bg-green-500 text-white">Requirement Met</Badge>}
                  </div>
                </CardHeader>
                <CardContent>
                  {product.offers.length > 0 ? (
                    <RadioGroup
                      value={selectedOffers[product.requisitionProductId]?.quotationDetailId || ""}
                      onValueChange={(value) => {
                        const selectedOfferDetail = product.offers.find(off => off.id === value);
                        handleOfferSelection(product.requisitionProductId, selectedOfferDetail || null);
                      }}
                    >
                      <div className="relative w-full overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Supplier</TableHead>
                              <TableHead className="text-right">Quoted Qty</TableHead>
                              <TableHead className="text-right">Unit Price</TableHead>
                              <TableHead className="text-right">Potential Award Qty</TableHead>
                              <TableHead className="text-right">Offer Line Total</TableHead>
                              <TableHead>Delivery ETA</TableHead>
                              <TableHead className="max-w-[100px]">Conditions</TableHead>
                              <TableHead className="text-center">Quote Details</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {product.offers.map((offer) => {
                              const isSelected = selectedOffers[product.requisitionProductId]?.quotationDetailId === offer.id;
                              const potentialAwardQty = Math.min(remainingToAwardForProduct, offer.quotedQuantity);
                              const canSelectOffer = remainingToAwardForProduct > 0 && offer.quotedQuantity > 0 && potentialAwardQty > 0;

                              return (
                                <TableRow key={offer.id} className={cn(isSelected && "bg-primary/10", currentQuoteIdFromParams === offer.quotationId && !isSelected && "bg-blue-50")}>
                                  <TableCell>
                                    <RadioGroupItem 
                                      value={offer.id} 
                                      id={`${product.requisitionProductId}-${offer.id}`}
                                      disabled={!canSelectOffer}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">{offer.supplierName}</TableCell>
                                  <TableCell className="text-right">{offer.quotedQuantity}</TableCell>
                                  <TableCell className="text-right">${Number(offer.unitPriceQuoted).toFixed(2)}</TableCell>
                                  <TableCell className="text-right font-semibold text-primary">{canSelectOffer ? potentialAwardQty : "-"}</TableCell>
                                  <TableCell className="text-right">${(Number(potentialAwardQty) * Number(offer.unitPriceQuoted)).toFixed(2)}</TableCell>
                                  <TableCell>{formatTimestampDate(offer.estimatedDeliveryDate)}</TableCell>
                                  <TableCell className="text-xs max-w-[150px] truncate" title={offer.conditions}>{offer.conditions || "N/A"}</TableCell>
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
              </Card>
            );
          })}

          {awardSummaryDetails.awardedItems.length > 0 && (
            <Card className="mt-6 shadow-lg">
              <CardHeader>
                <CardTitle className="font-headline">Award Summary</CardTitle>
                <CardDescription>Review your selections before finalizing. This action will update relevant statuses.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative w-full overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Awarded Supplier</TableHead>
                        <TableHead className="text-right">Awarded Qty</TableHead>
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
                    {Object.entries(awardSummaryDetails.uniqueAwardedQuotationInfo).map(([quoteId, info]) => 
                        info.additionalCosts.length > 0 && (
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
                  <p className="text-lg font-bold">Total Estimated Cost of Award: ${awardSummaryDetails.grandTotal.toFixed(2)}</p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end">
                <Button 
                  size="lg" 
                  onClick={handleFinalizeAwards} 
                  disabled={awardSummaryDetails.awardedItems.length === 0 || isSubmittingAwards || isLoading}
                >
                  {isSubmittingAwards ? <Icons.Logo className="mr-2 h-5 w-5 animate-spin" /> : <Icons.DollarSign className="mr-2 h-5 w-5" />}
                  {isSubmittingAwards ? "Processing..." : "Confirm & Finalize Awards"}
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

