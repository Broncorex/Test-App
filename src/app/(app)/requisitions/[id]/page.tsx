
"use client";

import { useParams, useRouter }
from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getRequisitionById, updateRequisitionStatus, type UpdateRequisitionData } from "@/services/requisitionService";
import type { Requisition, RequisitionStatus, RequiredProduct } from "@/types";
import { REQUISITION_STATUSES } from "@/types";
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icons } from "@/components/icons";

export default function RequisitionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requisitionId = params.id as string;
  const { toast } = useToast();
  const { appUser, role } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<RequisitionStatus | undefined>(undefined);

  useEffect(() => {
    if (!requisitionId || !appUser) return;

    async function fetchRequisition() {
      setIsLoading(true);
      try {
        const fetchedRequisition = await getRequisitionById(requisitionId);
        if (fetchedRequisition) {
          // Authorization check: employee can only see their own, admin/superadmin can see all
          if (role === 'employee' && fetchedRequisition.requestingUserId !== appUser.uid) {
            toast({ title: "Access Denied", description: "You do not have permission to view this requisition.", variant: "destructive" });
            router.replace("/requisitions");
            return;
          }
          setRequisition(fetchedRequisition);
          setSelectedStatus(fetchedRequisition.status);
        } else {
          toast({ title: "Error", description: "Requisition not found.", variant: "destructive" });
          router.replace("/requisitions");
        }
      } catch (error) {
        console.error("Error fetching requisition details:", error);
        toast({ title: "Error", description: "Failed to fetch requisition details.", variant: "destructive" });
      }
      setIsLoading(false);
    }
    fetchRequisition();
  }, [requisitionId, appUser, role, router, toast]);

  const handleStatusUpdate = async () => {
    if (!requisition || !selectedStatus || selectedStatus === requisition.status) {
      toast({title: "No Change", description: "Status is already set to the selected value or no status selected.", variant: "default"});
      return;
    }
    if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update the status.", variant: "destructive" });
      return;
    }

    setIsUpdatingStatus(true);
    try {
      await updateRequisitionStatus(requisitionId, selectedStatus);
      setRequisition(prev => prev ? { ...prev, status: selectedStatus, updatedAt: Timestamp.now() } : null);
      toast({ title: "Status Updated", description: `Requisition status changed to ${selectedStatus}.` });
    } catch (error) {
      console.error("Error updating requisition status:", error);
      toast({ title: "Update Failed", description: "Could not update requisition status.", variant: "destructive" });
    }
    setIsUpdatingStatus(false);
  };

  const getStatusBadgeVariant = (status: RequisitionStatus) => {
    switch (status) {
      case "Pending Quotation": return "secondary";
      case "Quoted": return "default";
      case "PO in Progress": return "outline";
      case "Completed": return "default"; // bg-green-500
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


  if (isLoading) {
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
        <PageHeader title="Requisition Not Found" description="The requested requisition could not be loaded." />
        <Button onClick={() => router.push("/requisitions")}>Back to List</Button>
      </div>
    );
  }

  const canManageStatus = role === 'admin' || role === 'superadmin';

  return (
    <>
      <PageHeader
        title={`Requisition: ${requisition.id.substring(0,8)}...`}
        description={`Details for requisition created on ${new Date(requisition.creationDate.seconds * 1000).toLocaleDateString()}`}
        actions={<Button onClick={() => router.back()} variant="outline">Back to List</Button>}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">Requisition Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Requisition ID:</span>
              <span className="font-medium">{requisition.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created By:</span>
              <span className="font-medium">{requisition.requestingUserName || requisition.requestingUserId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Creation Date:</span>
              <span className="font-medium">{new Date(requisition.creationDate.seconds * 1000).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(requisition.status)} className={getStatusBadgeClass(requisition.status)}>
                {requisition.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Notes:</span>
              <p className="font-medium whitespace-pre-wrap">{requisition.notes || "N/A"}</p>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Updated:</span>
              <span className="font-medium">{new Date(requisition.updatedAt.seconds * 1000).toLocaleString()}</span>
            </div>
          </CardContent>
           {canManageStatus && (
            <CardFooter className="border-t pt-4">
                <div className="w-full space-y-2">
                    <Label htmlFor="status-update" className="font-semibold">Update Status:</Label>
                    <div className="flex gap-2">
                    <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as RequisitionStatus)}>
                        <SelectTrigger id="status-update">
                        <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                        {REQUISITION_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleStatusUpdate} disabled={isUpdatingStatus || selectedStatus === requisition.status}>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead className="text-right">Required Qty</TableHead>
                    <TableHead className="text-right">Purchased Qty</TableHead>
                    <TableHead>Item Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requisition.requiredProducts.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right">{item.requiredQuantity}</TableCell>
                      <TableCell className="text-right">{item.purchasedQuantity}</TableCell>
                      <TableCell className="whitespace-pre-wrap">{item.notes || "N/A"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p>No products listed for this requisition.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
