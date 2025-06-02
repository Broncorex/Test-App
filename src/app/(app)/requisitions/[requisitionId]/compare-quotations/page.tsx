
"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Quotation, QuotationStatus } from "@/types";
import { getAllQuotations, updateQuotationStatus } from "@/services/quotationService";
import { useAuth } from "@/hooks/use-auth-store";
import { useToast } from "@/hooks/use-toast";
import { format, isValid } from "date-fns";
import { Timestamp } from "firebase/firestore"; // Ensure Timestamp is imported
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";

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

export default function CompareQuotationsPage({ params }: { params: { requisitionId: string } }) {
  const router = useRouter();
  const requisitionId = params.requisitionId;
  console.log("DEBUG: CompareQuotationsPage rendered for requisitionId:", requisitionId); // DEBUG LINE
  const { toast } = useToast();
  const { currentUser, role } = useAuth();

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAwarding, setIsAwarding] = useState<string | null>(null); 
  const [currentViewingQuotationId, setCurrentViewingQuotationId] = useState<string | null>(null);


  const fetchQuotationsForComparison = useCallback(async () => {
    if (!requisitionId) {
      setIsLoading(false);
      toast({ title: "Error", description: "Requisition ID is missing.", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const allQuotes = await getAllQuotations({ requisitionId });
      // Filter for statuses relevant to comparison
      setQuotations(allQuotes.filter(q => ["Received", "Awarded", "Partially Awarded", "Lost"].includes(q.status)));
    } catch (error) {
      console.error("Error fetching quotations for comparison:", error);
      toast({ title: "Error", description: "Could not load quotations for comparison.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [requisitionId, toast]);

  useEffect(() => {
    // Attempt to get current quotation ID from query params if navigating from quotation detail
    const queryParams = new URLSearchParams(window.location.search);
    setCurrentViewingQuotationId(queryParams.get("currentQuoteId"));
    fetchQuotationsForComparison();
  }, [fetchQuotationsForComparison]);

  const handleAwardQuotation = async (quotationIdToAward: string) => {
    if (!currentUser || (role !== 'admin' && role !== 'superadmin')) {
        toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive"});
        return;
    }
    setIsAwarding(quotationIdToAward);
    try {
        await updateQuotationStatus(quotationIdToAward, "Awarded", currentUser.uid);
        toast({ title: "Quotation Awarded", description: `Quotation ${quotationIdToAward.substring(0,6)}... has been marked as Awarded.`});
        fetchQuotationsForComparison(); 
    } catch (error: any) {
        toast({ title: "Award Failed", description: error.message || "Could not award quotation.", variant: "destructive"});
    }
    setIsAwarding(null);
  };

  return (
    <>
      <PageHeader
        title={`Compare Quotations`}
        description={`For Requisition ID: ${requisitionId ? requisitionId.substring(0, 8) + "..." : "N/A"}`}
        actions={<Button onClick={() => router.back()} variant="outline">Back</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Quotation Comparison</CardTitle>
          <CardDescription>Review received quotations to make an informed decision. The quotation you were previously viewing (if any) is highlighted.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : quotations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No relevant quotations found for comparison for this requisition.</p>
          ) : (
            <ScrollArea className="max-h-[calc(100vh-20rem)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Add. Costs</TableHead>
                    <TableHead className="text-right">Total Quote</TableHead>
                    <TableHead>Received Date</TableHead>
                    <TableHead className="text-center">Details</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotations.map((quote) => (
                    <TableRow key={quote.id} className={cn(quote.id === currentViewingQuotationId && "bg-primary/10")}>
                      <TableCell className="font-medium">{quote.supplierName || quote.supplierId.substring(0,8)+"..."}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(quote.status)} className={getStatusBadgeClass(quote.status)}>
                            {quote.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">${Number(quote.productsSubtotal || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${quote.additionalCosts?.reduce((sum, cost) => sum + Number(cost.amount), 0).toFixed(2) || '0.00'}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">${Number(quote.totalQuotation || 0).toFixed(2)}</TableCell>
                      <TableCell>{formatTimestampDate(quote.receivedDate)}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="sm" asChild>
                            <Link href={`/quotations/${quote.id}`} target="_blank" rel="noopener noreferrer">
                                <Icons.View className="h-4 w-4" />
                            </Link>
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        {(quote.status === "Received" || quote.status === "Partially Awarded") && (role === 'admin' || role === 'superadmin') && (
                            <Button 
                                size="sm" 
                                onClick={() => handleAwardQuotation(quote.id)}
                                disabled={isAwarding === quote.id}
                                className="bg-green-500 hover:bg-green-600 text-white"
                            >
                                {isAwarding === quote.id ? <Icons.Logo className="animate-spin" /> : "Award"}
                            </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
           { !isLoading && quotations.length > 0 && (
                <div className="mt-6 p-4 border rounded-md bg-muted/30">
                    <h4 className="font-semibold text-md mb-2">Key Comparison Points:</h4>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                        <li>Review <span className="font-semibold">Total Quoted Amount</span> for overall cost.</li>
                        <li>Check individual <span className="font-semibold">Product Subtotals</span> and <span className="font-semibold">Additional Costs</span> by viewing full details.</li>
                        <li>Consider <span className="font-semibold">Estimated Delivery Dates</span> (view details for product-specific ETAs).</li>
                        <li>Examine <span className="font-semibold">Shipping Conditions</span> and item-specific terms.</li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-3">This is a summary. Click the view icon for full details of each quotation.</p>
                </div>
            )}
        </CardContent>
      </Card>
    </>
  );
}

    