
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import type { Quotation, QuotationStatus, Supplier, Requisition } from "@/types"; // Assuming Requisition might be needed for filters
import { QUOTATION_STATUSES } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import { getAllQuotations, type QuotationFilters } from "@/services/quotationService";
import { getAllSuppliers } from "@/services/supplierService";
// Consider fetching requisitions if filtering by requisition number/ID is needed
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Timestamp } from "firebase/firestore";

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // const [requisitions, setRequisitions] = useState<Requisition[]>([]); // For Requisition ID filter if implemented

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [searchTermRequisitionId, setSearchTermRequisitionId] = useState(""); // For filtering by requisition ID
  const [filterSupplierId, setFilterSupplierId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<QuotationStatus | "all">("all");

  const { toast } = useToast();
  const { role, appUser } = useAuth();
  const router = useRouter();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchPageData = useCallback(async () => {
    if (!canManage || !appUser) return;
    setIsLoadingData(true);
    try {
      const [fetchedSuppliersData] = await Promise.all([
        getAllSuppliers(true), // Get active suppliers for filter
        // Potentially fetch requisitions here if needed for a dropdown filter
      ]);
      setSuppliers(fetchedSuppliersData);
      // setRequisitions(fetchedRequisitionsData);

      const quotationFilters: QuotationFilters = {
        requisitionId: searchTermRequisitionId || undefined,
        supplierId: filterSupplierId !== "all" ? filterSupplierId : undefined,
        status: filterStatus !== "all" ? filterStatus : undefined,
      };
      const fetchedQuotations = await getAllQuotations(quotationFilters);
      setQuotations(fetchedQuotations);

    } catch (error) {
      console.error("Error fetching quotations page data:", error);
      toast({ title: "Error", description: "Failed to fetch quotation data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, canManage, appUser, searchTermRequisitionId, filterSupplierId, filterStatus]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]);
  
  const formatTimestamp = (timestamp: Timestamp | string | null | undefined): string => {
    if (!timestamp) return "N/A";
    if (typeof timestamp === 'string') return new Date(timestamp).toLocaleDateString();
    if (timestamp instanceof Timestamp) return timestamp.toDate().toLocaleDateString();
    return "Invalid Date";
  };

  const getStatusBadgeVariant = (status?: QuotationStatus) => {
    if (!status) return "secondary";
    switch (status) {
      case "Sent": return "outline";
      case "Received": return "default";
      case "Awarded": return "default"; // bg-green-500
      case "Partially Awarded": return "default"; // bg-yellow-500
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


  return (
    <>
      <PageHeader
        title="Quotation Management"
        description="View, track, and manage supplier quotations."
        // Add "New Quotation Request" button if direct creation is allowed, otherwise it's from Requisition
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Quotation List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
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
                    <TableCell>{formatTimestamp(quotation.requestDate)}</TableCell>
                    <TableCell>{formatTimestamp(quotation.responseDeadline)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(quotation.status)} className={getStatusBadgeClass(quotation.status)}>
                        {quotation.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {quotation.totalQuotation !== undefined ? `$${Number(quotation.totalQuotation).toFixed(2)}` : "N/A"}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/quotations/${quotation.id}`)}>
                        <Icons.View className="h-4 w-4" />
                      </Button>
                      {/* Add other actions like "Mark as Received", "Award" here or in detail view */}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No quotations found.
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
