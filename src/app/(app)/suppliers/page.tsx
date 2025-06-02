
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Supplier } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import {
  getAllSuppliers,
  toggleSupplierActiveStatus,
} from "@/services/supplierService";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const { role } = useAuth(); // Auth already checked by layout
  const router = useRouter();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchSuppliers = useCallback(async () => {
    if (!canManage) return;
    setIsLoadingData(true);
    try {
      const fetchedSuppliers = await getAllSuppliers(!showInactive); // if showInactive is true, filterActive is false
      setSuppliers(fetchedSuppliers);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast({ title: "Error", description: "Failed to fetch suppliers.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, showInactive, canManage]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleToggleActive = async (supplierId: string, currentIsActive: boolean) => {
    if (!canManage) return;
    try {
      await toggleSupplierActiveStatus(supplierId, currentIsActive);
      toast({ title: "Status Updated", description: `Supplier ${currentIsActive ? "deactivated" : "activated"}.` });
      fetchSuppliers(); // Refresh list
    } catch (error: any) {
      console.error("Error toggling supplier status:", error);
      toast({ title: "Error", description: error.message || "Failed to update status.", variant: "destructive" });
    }
  };

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter(supplier => {
      const sTerm = searchTerm.toLowerCase();
      return (
        supplier.name.toLowerCase().includes(sTerm) ||
        supplier.contactPerson.toLowerCase().includes(sTerm) ||
        supplier.contactEmail.toLowerCase().includes(sTerm)
      );
    });
  }, [suppliers, searchTerm]);

  return (
    <>
      <PageHeader
        title="Supplier Management"
        description="Manage your suppliers and their contact information."
        actions={
          canManage && (
            <Button onClick={() => router.push('/suppliers/new')}>
              <Icons.Add className="mr-2 h-4 w-4" /> Add New Supplier
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <CardTitle className="font-headline">Supplier List</CardTitle>
            <div className="flex items-center gap-4 w-full md:w-auto">
              <Input
                placeholder="Search by name, contact..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full md:w-64"
              />
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-inactive-suppliers"
                  checked={showInactive}
                  onCheckedChange={(checked) => setShowInactive(checked as boolean)}
                />
                <Label htmlFor="show-inactive-suppliers">Show Inactive</Label>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-supplier-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-32 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredSuppliers.length > 0 ? (
                filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.contactPerson}</TableCell>
                    <TableCell>{supplier.contactEmail}</TableCell>
                    <TableCell>{supplier.contactPhone}</TableCell>
                    <TableCell>{supplier.address}</TableCell>
                    <TableCell>
                      <Badge variant={supplier.isActive ? "default" : "destructive"} className={supplier.isActive ? "bg-green-500 text-white hover:bg-green-600" : "hover:bg-red-700"}>
                        {supplier.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/suppliers/${supplier.id}/edit`)}>
                        <Icons.Edit className="h-4 w-4 mr-1" /> Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant={supplier.isActive ? "destructive" : "secondary"}
                            size="sm"
                          >
                            {supplier.isActive ? "Deactivate" : "Restore"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action will {supplier.isActive ? "deactivate" : "restore"} the supplier: {supplier.name}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleToggleActive(supplier.id, supplier.isActive)}>
                              Confirm
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    No suppliers found. {searchTerm && "Try a different search term or filter."}
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
