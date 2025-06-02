
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Requisition, RequisitionStatus, User } from "@/types";
import { REQUISITION_STATUSES } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import { getAllRequisitions, type RequisitionFilters } from "@/services/requisitionService";
import { Badge } from "@/components/ui/badge";
import { Timestamp } from "firebase/firestore";

export default function RequisitionsPage() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [filterStatus, setFilterStatus] = useState<RequisitionStatus | "all">("all");
  const [filterRequestingUserName, setFilterRequestingUserName] = useState<string>(""); 

  const { toast } = useToast();
  const { role, appUser, currentUser } = useAuth();
  const router = useRouter();

  const canManageAll = role === 'admin' || role === 'superadmin';

  const fetchPageData = useCallback(async () => {
    if (!appUser || !currentUser) return;
    setIsLoadingData(true);
    try {
      const filters: RequisitionFilters = {
        status: filterStatus !== "all" ? filterStatus : undefined,
        // We will not pass userName to backend for filtering; it will be client-side for admins
        // If user is employee, backend handles filtering by their ID.
        // If admin is filtering by a specific User ID (not name), that would go here, but current UI is name based.
      };
      
      const fetchedRequisitions = await getAllRequisitions(filters, currentUser.uid, role);
      setRequisitions(fetchedRequisitions);

    } catch (error) {
      console.error("Error fetching requisitions page data:", error);
      toast({ title: "Error", description: "Failed to fetch requisitions.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, appUser, currentUser, role, filterStatus]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]);

  const formatTimestamp = (timestamp: Timestamp | string | null | undefined): string => {
    if (!timestamp) return "N/A";
    if (typeof timestamp === 'string') return new Date(timestamp).toLocaleDateString();
    if (timestamp instanceof Timestamp) return timestamp.toDate().toLocaleDateString();
    return "Invalid Date";
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

  const displayedRequisitions = useMemo(() => {
    let filtered = requisitions;

    if (canManageAll && filterRequestingUserName.trim() !== "") {
      const lowerCaseFilterName = filterRequestingUserName.trim().toLowerCase();
      filtered = filtered.filter(req => 
        req.requestingUserName?.toLowerCase().includes(lowerCaseFilterName)
      );
    }
    return filtered;
  }, [requisitions, filterRequestingUserName, canManageAll]);

  const relevantStatusesForComparison: RequisitionStatus[] = ["Quoted", "PO in Progress", "Completed", "Canceled"];
  // Note: "Canceled" is included because one might want to review why it was canceled by looking at quotes.
  // "Pending Quotation" is excluded as no quotes would exist yet.

  return (
    <>
      <PageHeader
        title="Requisition Management"
        description="View, track, and manage purchase requisitions."
        actions={
          <Button onClick={() => router.push('/requisitions/new')}>
            <Icons.Add className="mr-2 h-4 w-4" /> Create New Requisition
          </Button>
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Requisition List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as RequisitionStatus | "all")}>
              <SelectTrigger><SelectValue placeholder="Filter by Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {REQUISITION_STATUSES.map(stat => <SelectItem key={stat} value={stat}>{stat}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManageAll && (
              <Input
                placeholder="Filter by Requesting User Name..."
                value={filterRequestingUserName}
                onChange={(e) => setFilterRequestingUserName(e.target.value)}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requisition ID</TableHead>
                <TableHead>Requesting User</TableHead>
                <TableHead>Creation Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-requisition-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-48 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : displayedRequisitions.length > 0 ? (
                displayedRequisitions.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium truncate max-w-[150px]">{req.id}</TableCell>
                    <TableCell>{req.requestingUserName || "N/A"}</TableCell>
                    <TableCell>{formatTimestamp(req.creationDate)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(req.status)} className={getStatusBadgeClass(req.status)}>
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/requisitions/${req.id}`)}>
                        <Icons.View className="h-4 w-4 mr-1" /> View Details
                      </Button>
                      {canManageAll && relevantStatusesForComparison.includes(req.status) && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/requisitions/${req.id}/compare-quotations`}>
                            <Icons.LayoutList className="h-4 w-4 mr-1" /> Compare Quotes
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No requisitions found matching your criteria.
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
