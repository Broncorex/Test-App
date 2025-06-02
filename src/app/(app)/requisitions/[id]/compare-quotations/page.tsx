
"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { Quotation, QuotationStatus, QuotationDetail, Requisition, RequiredProduct as RequisitionRequiredProduct } from "@/types";
import { getAllQuotations, getQuotationById, updateQuotationStatus } from "@/services/quotationService";
import { getRequisitionById } from "@/services/requisitionService";
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
}

interface ProductToCompare extends RequisitionRequiredProduct {
  requisitionProductId: string; // Using the subcollection item's ID for unique key
  offers: QuotationOffer[];
  alreadyPurchased: number;
}

interface SelectedOfferInfo {
  quotationId: string;
  quotationDetailId: string; // This is the 'id' from QuotationDetail
  supplierName: string;
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

const getStatusBadgeVariant = (status?: QuotationStatus) => {
  if (!status) return "secondary";
  switch (status) {
    case "Sent": return "outline";
    case "Received": return "default";
    case "Awarded": return "default"; 
    case "Partially Awarded": return "default"; 
    case "Rejected":
    case "Lost":
      return "destructive";
    default: return "secondary";
  }
};

const getStatusBadgeClass = (status?: QuotationStatus) => {
  if (!status) return "";
  switch (status) {
    case "Awarded": return "bg-green-500 hover:bg-green-600 text-white";
    case "Partially Awarded": return "bg-yellow-400 hover:bg-yellow-500 text-black";
    default: return "";
  }
};

export default function CompareQuotationsPage() {
  const params = useParams();
  const router = useRouter();
  const requisitionId = params.id as string; 
  
  const { toast } = useToast();
  const { currentUser, role } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [productsForComparison, setProductsForComparison] = useState<ProductToCompare[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAwarding, setIsAwarding] = useState<string | null>(null); // For individual award from summary table
  const [currentViewingQuotationId, setCurrentViewingQuotationId] = useState<string | null>(null); // From query param

  const [selectedOffers, setSelectedOffers] = useState<Record<string, SelectedOfferInfo | null>>({}); // Key: requisitionProductId

  const fetchComparisonData = useCallback(async () => {
    if (!requisitionId) {
      setIsLoading(false);
      toast({ title: "Error", description: "Requisition ID is missing.", variant: "destructive" });
      return;
    }
    console.log("DEBUG: CompareQuotationsPage fetching data for requisitionId:", requisitionId);
    setIsLoading(true);
    setSelectedOffers({}); // Reset selections on new data fetch

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
      
      const relevantQuotesWithDetails: Quotation[] = [];
      for (const quoteHeader of allQuotesForRequisition) {
        if (["Received", "Awarded", "Partially Awarded", "Lost"].includes(quoteHeader.status)) {
          const detailedQuote = await getQuotationById(quoteHeader.id); // Fetch full details including subcollection
          if (detailedQuote) {
            relevantQuotesWithDetails.push(detailedQuote);
          }
        }
      }
      
      const productsToCompareMap = new Map<string, ProductToCompare>();

      fetchedRequisition.requiredProducts.forEach(reqProduct => {
        productsToCompareMap.set(reqProduct.productId, {
          ...reqProduct,
          requisitionProductId: reqProduct.id, // Use the subcollection item ID as a unique key for selection state
          offers: [],
          alreadyPurchased: reqProduct.purchasedQuantity || 0,
        });
      });

      relevantQuotesWithDetails.forEach(quote => {
        quote.quotationDetails?.forEach(detail => {
          const productEntry = productsToCompareMap.get(detail.productId);
          if (productEntry) {
            productEntry.offers.push({
              ...detail,
              quotationId: quote.id,
              supplierName: quote.supplierName || "Unknown Supplier",
              supplierId: quote.supplierId,
              overallQuotationStatus: quote.status,
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
    // For client components, access searchParams via useSearchParams hook if needed,
    // but for this case, we are mainly using path param.
    // If currentQuoteId was in searchParams:
    // const searchParams = useSearchParams();
    // setCurrentViewingQuotationId(searchParams.get("currentQuoteId"));
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
        
        if (quantityToAwardThisTime <= 0) {
            toast({ title: "Cannot Select", description: "Required quantity already met or offer has zero quantity.", variant: "default"});
            updated[requisitionProductId] = null; // Deselect or prevent selection
        } else {
            updated[requisitionProductId] = {
                quotationId: offer.quotationId,
                quotationDetailId: offer.id,
                supplierName: offer.supplierName,
                productId: offer.productId,
                productName: offer.productName,
                awardedQuantity: quantityToAwardThisTime,
                unitPrice: offer.unitPriceQuoted,
            };
        }
      } else {
        updated[requisitionProductId] = null; // Deselect
      }
      return updated;
    });
  };

  const totalSelectedAwardCost = useMemo(() => {
    return Object.values(selectedOffers).reduce((sum, offer) => {
      if (offer) return sum + (offer.awardedQuantity * offer.unitPrice);
      return sum;
    }, 0);
  }, [selectedOffers]);

  const handleFinalizeAwards = async () => {
    if (Object.values(selectedOffers).every(offer => offer === null)) {
        toast({ title: "No Selections", description: "Please select at least one offer to award.", variant: "default" });
        return;
    }
    if (!currentUser || (role !== 'admin' && role !== 'superadmin')) {
        toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive"});
        return;
    }
    // TODO: Implement actual backend logic for finalizing awards.
    // This would involve:
    // 1. Grouping selected offers by quotationId.
    // 2. Updating each involved Quotation's status (e.g., to "Partially Awarded" or "Awarded").
    // 3. Updating `purchasedQuantity` on the Requisition's `requiredProducts`.
    // 4. Updating the overall Requisition status if fully awarded.
    // 5. Potentially creating Purchase Orders.
    console.log("Finalizing awards with selections:", selectedOffers);
    toast({ title: "Awards Finalized (Simulated)", description: "Selected offers have been processed (simulation). Backend logic needed.", variant: "success"});
    // Possibly re-fetch data or navigate
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
        description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "N/A"}`}
        actions={<Button onClick={() => router.back()} variant="outline">Back</Button>}
      />
      
      {productsForComparison.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>No Quotations Found</CardTitle></CardHeader>
          <CardContent><p>No relevant quotations (Received, Awarded, etc.) found for this requisition to compare.</p></CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {productsForComparison.map((product) => {
            const remainingToAward = product.requiredQuantity - product.alreadyPurchased;
            return (
              <Card key={product.requisitionProductId} className="shadow-md">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="font-headline text-xl">{product.productName}</CardTitle>
                      <CardDescription>
                        Required: {product.requiredQuantity} | 
                        Purchased/Awarded: {product.alreadyPurchased} | 
                        <span className={cn("font-semibold", remainingToAward <= 0 ? "text-green-600" : "text-orange-600")}>
                          {" "}Remaining: {remainingToAward > 0 ? remainingToAward : 0}
                        </span>
                      </CardDescription>
                    </div>
                    {remainingToAward <= 0 && <Badge variant="default" className="bg-green-500 text-white">Requirement Met</Badge>}
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
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead> {/* Radio button */}
                            <TableHead>Supplier</TableHead>
                            <TableHead className="text-right">Quoted Qty</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Offer Total</TableHead>
                            <TableHead>Delivery ETA</TableHead>
                            <TableHead>Conditions</TableHead>
                            <TableHead className="text-center">View Full Quote</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {product.offers.map((offer) => {
                            const isSelected = selectedOffers[product.requisitionProductId]?.quotationDetailId === offer.id;
                            const effectiveAwardQty = isSelected ? selectedOffers[product.requisitionProductId]!.awardedQuantity : Math.min(remainingToAward, offer.quotedQuantity);
                            const canSelectOffer = remainingToAward > 0 && offer.quotedQuantity > 0;

                            return (
                              <TableRow key={offer.id} className={cn(isSelected && "bg-primary/10")}>
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
                                <TableCell className="text-right font-semibold">${(Number(offer.quotedQuantity) * Number(offer.unitPriceQuoted)).toFixed(2)}</TableCell>
                                <TableCell>{formatTimestampDate(offer.estimatedDeliveryDate)}</TableCell>
                                <TableCell className="text-xs max-w-[150px] truncate" title={offer.conditions}>{offer.conditions || "N/A"}</TableCell>
                                <TableCell className="text-center">
                                  <Button variant="ghost" size="icon" asChild>
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
                    </RadioGroup>
                  ) : (
                    <p className="text-sm text-muted-foreground">No supplier offers received for this product yet.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {Object.values(selectedOffers).some(s => s !== null) && (
            <Card className="mt-6 shadow-lg">
              <CardHeader>
                <CardTitle className="font-headline">Award Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Awarded Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(selectedOffers).map(([reqProdId, selection]) => {
                      if (!selection) return null;
                      return (
                        <TableRow key={reqProdId}>
                          <TableCell>{selection.productName}</TableCell>
                          <TableCell>{selection.supplierName}</TableCell>
                          <TableCell className="text-right">{selection.awardedQuantity}</TableCell>
                          <TableCell className="text-right">${selection.unitPrice.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold">${(selection.awardedQuantity * selection.unitPrice).toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="mt-4 text-right">
                  <p className="text-lg font-bold">Total Estimated Cost: ${totalSelectedAwardCost.toFixed(2)}</p>
                </div>
                 <div className="mt-6 p-4 border rounded-md bg-muted/30">
                    <h4 className="font-semibold text-md mb-2">Next Steps:</h4>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                        <li>Review your selections carefully.</li>
                        <li>Ensure all required quantities you intend to award now are covered.</li>
                        <li>Clicking "Confirm & Finalize Awards" will (eventually) update quotation and requisition statuses, and could lead to Purchase Order generation.</li>
                    </ul>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end">
                <Button size="lg" onClick={handleFinalizeAwards} disabled={Object.values(selectedOffers).every(offer => offer === null)}>
                  <Icons.DollarSign className="mr-2 h-5 w-5" /> Confirm & Finalize Awards (Simulated)
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
