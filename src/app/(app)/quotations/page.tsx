
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Quotation, QuotationStatus, Supplier } from "@/types";
import { QUOTATION_STATUSES } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import { getAllQuotations, type QuotationFilters } from "@/services/quotationService";
import { getAllSuppliers } from "@/services/supplierService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Timestamp } from "firebase/firestore";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [searchTermRequisitionId, setSearchTermRequisitionId] = useState("");
  const [filterSupplierId, setFilterSupplierId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<QuotationStatus | "all">("all");
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>(undefined);
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>(undefined);


  const { toast } = useToast();
  const { role, appUser } = useAuth();
  const router = useRouter();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchPageData = useCallback(async () => {
    if (!canManage || !appUser) return;
    setIsLoadingData(true);
    try {
      const [fetchedSuppliersData] = await Promise.all([
        getAllSuppliers(true),
      ]);
      setSuppliers(fetchedSuppliersData);

      const quotationFilters: QuotationFilters = {
        requisitionId: searchTermRequisitionId || undefined,
        supplierId: filterSupplierId !== "all" ? filterSupplierId : undefined,
        status: filterStatus !== "all" ? filterStatus : undefined,
        // Backend service needs to be updated to handle dateFrom and dateTo if server-side filtering is desired
        dateFrom: filterDateFrom ? Timestamp.fromDate(filterDateFrom) : undefined,
        dateTo: filterDateTo ? Timestamp.fromDate(new Date(filterDateTo.setHours(23, 59, 59, 999))) : undefined,
      };
      const fetchedQuotations = await getAllQuotations(quotationFilters);
      setQuotations(fetchedQuotations);

    } catch (error) {
      console.error("Error fetching quotations page data:", error);
      toast({ title: "Error", description: "Failed to fetch quotation data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, canManage, appUser, searchTermRequisitionId, filterSupplierId, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]);
  
  const formatTimestampDate = (timestamp: Timestamp | string | null | undefined): string => {
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

  const handleEditQuotation = (quotationId: string) => {
    console.log("Navigate to edit page or open edit modal for:", quotationId);
    // router.push(`/quotations/${quotationId}/edit`); // Or open modal
  };

  const handleMarkAsReceived = (quotationId: string) => {
    console.log("Open mark as received modal for:", quotationId);
     // This would typically open a modal similar to the one on the detail page
     // For now, we can navigate to the detail page where the modal exists
    router.push(`/quotations/${quotationId}`);
  };

  const handleAwardQuotation = (quotationId: string) => {
     console.log("Trigger award process for:", quotationId);
    // This would involve status update and potentially PO generation flow
    // For now, direct to detail page to use existing Award button
    router.push(`/quotations/${quotationId}`);
  };


  return (
    <>
      <PageHeader
        title="Quotation Management"
        description="View, track, and manage supplier quotations."
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Quotation List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input
              placeholder="Filter by Requisition ID..."
              value={searchTermRequisitionId}
              onChange={(e) => setSearchTermRequisitionId(e.target.value)}
            />
            <Select value={filterSupplierId} onValueChange={setFilterSupplierId}>
              <SelectTrigger><SelectValue placeholder="Filter by Supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {suppliers.map(sup => <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as QuotationStatus | "all")}>
              <SelectTrigger><SelectValue placeholder="Filter by Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {QUOTATION_STATUSES.map(stat => <SelectItem key={stat} value={stat}>{stat}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="space-y-1">
                <Label htmlFor="date-from">Request Date From</Label>
                <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        id="date-from"
                        variant={"outline"}
                        className={cn("w-full justify-start text-left font-normal", !filterDateFrom && "text-muted-foreground")}
                    >
                        <Icons.Calendar className="mr-2 h-4 w-4" />
                        {filterDateFrom ? format(filterDateFrom, "PPP") : <span>Pick a start date</span>}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={filterDateFrom} onSelect={setFilterDateFrom} initialFocus />
                    </PopoverContent>
                </Popover>
            </div>
            <div className="space-y-1">
                <Label htmlFor="date-to">Request Date To</Label>
                <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        id="date-to"
                        variant={"outline"}
                        className={cn("w-full justify-start text-left font-normal", !filterDateTo && "text-muted-foreground")}
                    >
                        <Icons.Calendar className="mr-2 h-4 w-4" />
                        {filterDateTo ? format(filterDateTo, "PPP") : <span>Pick an end date</span>}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={filterDateTo} onSelect={setFilterDateTo} initialFocus disabled={(date) => filterDateFrom ? date < filterDateFrom : false }/>
                    </PopoverContent>
                </Popover>
            </div>
            <Button onClick={() => { setFilterDateFrom(undefined); setFilterDateTo(undefined);}} variant="outline" className="self-end">Clear Dates</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quotation ID</TableHead>
                <TableHead>Requisition ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Request Date</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-quotation-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-32 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : quotations.length > 0 ? (
                quotations.map((quotation) => (
                  <TableRow key={quotation.id}>
                    <TableCell className="font-medium truncate max-w-[100px]">{quotation.id}</TableCell>
                    <TableCell className="truncate max-w-[100px]">
                        <Link href={`/requisitions/${quotation.requisitionId}`} className="text-primary hover:underline">
                         {quotation.requisitionId.substring(0,8)}...
                        </Link>
                    </TableCell>
                    <TableCell>{quotation.supplierName || quotation.supplierId}</TableCell>
                    <TableCell>{formatTimestampDate(quotation.requestDate)}</TableCell>
                    <TableCell>{formatTimestampDate(quotation.responseDeadline)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(quotation.status)} className={getStatusBadgeClass(quotation.status)}>
                        {quotation.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {quotation.totalQuotation !== undefined && quotation.totalQuotation !== null ? `$${Number(quotation.totalQuotation).toFixed(2)}` : "N/A"}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/quotations/${quotation.id}`)}>
                        <Icons.View className="h-4 w-4" />
                      </Button>
                      {canManage && quotation.status === "Sent" && (
                        <Button variant="outline" size="sm" onClick={() => handleEditQuotation(quotation.id)} title="Edit Quotation">
                          <Icons.Edit className="h-4 w-4" />
                        </Button>
                      )}
                      {canManage && quotation.status === "Sent" && (
                         <Button variant="outline" size="sm" onClick={() => handleMarkAsReceived(quotation.id)} title="Mark as Received">
                            <Icons.Package className="h-4 w-4" /> {/* Placeholder icon */}
                        </Button>
                      )}
                       {canManage && (quotation.status === "Received" || quotation.status === "Partially Awarded") && (
                         <Button variant="default" size="sm" onClick={() => handleAwardQuotation(quotation.id)} title="Award Quotation" className="bg-green-500 hover:bg-green-600 text-white">
                            <Icons.DollarSign className="h-4 w-4" /> {/* Placeholder, consider Award icon */}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No quotations found matching your criteria.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

    