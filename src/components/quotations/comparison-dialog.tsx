
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Quotation, QuotationStatus } from "@/types";
import { format, isValid } from "date-fns";
import type { Timestamp } from "firebase/firestore";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";

interface ComparisonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  quotations: Quotation[];
  isLoading: boolean;
  currentRequisitionId: string;
  currentQuotationId: string;
}

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


export function ComparisonDialog({
  isOpen,
  onClose,
  quotations,
  isLoading,
  currentRequisitionId,
  currentQuotationId,
}: ComparisonDialogProps) {

  const handleAwardFromComparison = (quotationId: string) => {
    // This would ideally call a service function that also handles partial awards
    // or links to PO generation. For now, it can log or trigger a toast.
    console.log(`Awarding quotation ${quotationId} from comparison view.`);
    // Potentially navigate or call a service: updateQuotationStatus(quotationId, "Awarded", currentUser.uid);
    onClose(); // Close dialog after action
  };

  const otherQuotations = quotations.filter(q => q.id !== currentQuotationId);


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl md:max-w-5xl lg:max-w-6xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="font-headline text-xl">
            Compare Quotations for Requisition: <Link href={`/requisitions/${currentRequisitionId}`} className="text-primary hover:underline">{currentRequisitionId.substring(0,8)}...</Link>
          </DialogTitle>
          <DialogDescription>
            Review and compare received quotations to make an informed decision.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : quotations.length === 0 ? (
            <p className="text-center text-muted-foreground">No quotations found for this requisition.</p>
          ) : quotations.length === 1 && quotations[0].id === currentQuotationId ? (
             <p className="text-center text-muted-foreground">Only the current quotation has been received or is relevant for comparison.</p>
          ) : (
            <ScrollArea className="h-full">
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
                    <TableRow key={quote.id} className={cn(quote.id === currentQuotationId && "bg-primary/10")}>
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
                        {(quote.status === "Received" || quote.status === "Partially Awarded") && (
                            <Button 
                                size="sm" 
                                onClick={() => handleAwardFromComparison(quote.id)}
                                className="bg-green-500 hover:bg-green-600 text-white"
                            >
                                Award
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
                <div className="mt-4 p-3 border rounded-md bg-muted/30">
                    <h4 className="font-semibold text-md mb-2">Key Comparison Points:</h4>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                        <li>Review <span className="font-semibold">Total Quoted Amount</span> for overall cost.</li>
                        <li>Check individual <span className="font-semibold">Product Subtotals</span> and <span className="font-semibold">Additional Costs</span>.</li>
                        <li>Consider <span className="font-semibold">Estimated Delivery Dates</span> (view details for product-specific ETAs).</li>
                        <li>Examine <span className="font-semibold">Shipping Conditions</span> and item-specific terms.</li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-3">This is a summary. Click view icon for full details of each quotation.</p>
                </div>
            )}
        </div>

        <DialogFooter className="pt-4 flex-shrink-0">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

