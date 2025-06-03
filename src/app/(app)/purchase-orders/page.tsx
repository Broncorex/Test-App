
"use client";

import React, { useState, useEffect, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { PurchaseOrder, PurchaseOrderStatus, Supplier } from "@/types";
import { PURCHASE_ORDER_STATUSES } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import { getAllPurchaseOrders, type PurchaseOrderFilters } from "@/services/purchaseOrderService";
import { getAllSuppliers } from "@/services/supplierService";
import { Badge } from "@/components/ui/badge";
import { Timestamp } from "firebase/firestore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export default function PurchaseOrdersPage() {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [filterSupplierId, setFilterSupplierId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<PurchaseOrderStatus | "all">("all");
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
      const fetchedSuppliersData = await getAllSuppliers(true); 
      setSuppliers(fetchedSuppliersData);

      const poFilters: PurchaseOrderFilters = {
        supplierId: filterSupplierId !== "all" ? filterSupplierId : undefined,
        status: filterStatus !== "all" ? filterStatus : undefined,
        orderDateFrom: filterDateFrom ? Timestamp.fromDate(filterDateFrom) : undefined,
        orderDateTo: filterDateTo ? Timestamp.fromDate(new Date(filterDateTo.setHours(23, 59, 59, 999))) : undefined,
      };
      const fetchedPOs = await getAllPurchaseOrders(poFilters);
      setPurchaseOrders(fetchedPOs);

    } catch (error) {
      console.error("Error fetching PO page data:", error);
      toast({ title: "Error", description: "Failed to fetch purchase order data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, canManage, appUser, filterSupplierId, filterStatus, filterDateFrom, filterDateTo]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]);

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

  const getStatusBadgeVariant = (status?: PurchaseOrderStatus) => {
    if (!status) return "secondary";
    switch (status) {
      case "Pending": return "outline";
      case "SentToSupplier": return "default";
      case "ConfirmedBySupplier": return "default";
      case "RejectedBySupplier": return "destructive";
      case "Partially Received": return "default";
      case "Completed": return "default";
      case "Canceled": return "destructive";
      default: return "secondary";
    }
  };
  const getStatusBadgeClass = (status?: PurchaseOrderStatus) => {
    if (!status) return "";
    switch (status) {
      case "SentToSupplier": return "bg-blue-500 hover:bg-blue-600 text-white";
      case "ConfirmedBySupplier": return "bg-teal-500 hover:bg-teal-600 text-white";
      case "Partially Received": return "bg-yellow-400 hover:bg-yellow-500 text-black";
      case "Completed": return "bg-green-500 hover:bg-green-600 text-white";
      default: return "";
    }
  };

  return (
    <>
      <PageHeader
        title="Purchase Order Management"
        description="Track and manage purchase orders sent to suppliers."
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Purchase Order List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Select value={filterSupplierId} onValueChange={setFilterSupplierId}>
              <SelectTrigger><SelectValue placeholder="Filter by Supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {suppliers.map(sup => <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as PurchaseOrderStatus | "all")}>
              <SelectTrigger><SelectValue placeholder="Filter by Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {PURCHASE_ORDER_STATUSES.map(stat => <SelectItem key={stat} value={stat}>{stat}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="space-y-1">
                <Label htmlFor="date-from">Order Date From</Label>
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
                <Label htmlFor="date-to">Order Date To</Label>
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
            <Button onClick={() => { setFilterDateFrom(undefined); setFilterDateTo(undefined);}} variant="outline" className="self-end md:col-span-2 lg:col-span-1">Clear Dates</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Expected Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-po-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : purchaseOrders.length > 0 ? (
                purchaseOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium truncate max-w-[100px]">{po.id}</TableCell>
                    <TableCell>{po.supplierName || po.supplierId}</TableCell>
                    <TableCell>{formatTimestampDate(po.orderDate)}</TableCell>
                    <TableCell>{formatTimestampDate(po.expectedDeliveryDate)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(po.status)} className={getStatusBadgeClass(po.status)}>
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">${Number(po.totalAmount).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                        <Icons.View className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    No purchase orders found matching your criteria.
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

    