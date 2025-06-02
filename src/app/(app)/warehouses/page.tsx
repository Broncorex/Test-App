
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label"; 
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Warehouse } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import {
  addWarehouse,
  getWarehouses,
  updateWarehouse,
  toggleWarehouseActiveStatus,
  isWarehouseNameUnique,
  setDefaultWarehouse,
  type CreateWarehouseData,
  type UpdateWarehouseData,
} from "@/services/warehouseService";
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
import { Form, FormField, FormItem, FormControl, FormLabel } from "@/components/ui/form";

const warehouseFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, "Name must be at least 3 characters."),
  location: z.string().optional(),
  description: z.string().optional(),
  contactPerson: z.string().min(2, "Contact person name is required."),
  contactPhone: z.string().min(7, "Contact phone is required."),
  isDefault: z.boolean().default(false),
});

type WarehouseFormData = z.infer<typeof warehouseFormSchema>;

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const { toast } = useToast();
  const { currentUser, role } = useAuth();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchWarehouses = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const fetchedWarehouses = await getWarehouses(showInactive);
      setWarehouses(fetchedWarehouses);
    } catch (error) {
      console.error("Error fetching warehouses:", error);
      toast({ title: "Error", description: "Failed to fetch warehouses.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, showInactive]);

  useEffect(() => {
    if (canManage) {
      fetchWarehouses();
    } else {
      setIsLoadingData(false); // Not allowed, stop loading
    }
  }, [fetchWarehouses, canManage]);

  const form = useForm<WarehouseFormData>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: {
      name: "",
      location: "",
      description: "",
      contactPerson: "",
      contactPhone: "",
      isDefault: false,
    },
  });

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    form.reset({
      id: warehouse.id,
      name: warehouse.name,
      location: warehouse.location || "",
      description: warehouse.description || "",
      contactPerson: warehouse.contactPerson,
      contactPhone: warehouse.contactPhone,
      isDefault: warehouse.isDefault,
    });
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setEditingWarehouse(null);
    form.reset({
      name: "",
      location: "",
      description: "",
      contactPerson: "",
      contactPhone: "",
      isDefault: false,
    });
    setIsDialogOpen(true);
  };

  const handleToggleActive = async (warehouseId: string, currentIsActive: boolean) => {
    if (!canManage) return;
    setIsSubmitting(true);
    try {
      await toggleWarehouseActiveStatus(warehouseId, currentIsActive);
      toast({ title: "Status Updated", description: `Warehouse ${currentIsActive ? "deactivated" : "activated"}.` });
      fetchWarehouses();
    } catch (error: any) {
      console.error("Error toggling warehouse status:", error);
      toast({ title: "Error", description: error.message || "Failed to update status.", variant: "destructive" });
    }
    setIsSubmitting(false);
  };
  
  const handleSetDefault = async (warehouseId: string) => {
    if (!canManage) return;
    setIsSubmitting(true);
    try {
      await setDefaultWarehouse(warehouseId);
      toast({ title: "Default Set", description: "Warehouse set as default." });
      fetchWarehouses();
    } catch (error: any) {
      console.error("Error setting default warehouse:", error);
      toast({ title: "Error", description: error.message || "Failed to set default warehouse.", variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  const onSubmit = async (data: WarehouseFormData) => {
    if (!currentUser || !canManage) {
      toast({ title: "Error", description: "User not authorized or not found.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const nameIsUnique = await isWarehouseNameUnique(data.name, editingWarehouse?.id);
    if (!nameIsUnique) {
      form.setError("name", { type: "manual", message: "Warehouse name must be unique." });
      setIsSubmitting(false);
      return;
    }

    try {
      if (editingWarehouse && editingWarehouse.id) {
        const updateData: UpdateWarehouseData = {
          name: data.name,
          location: data.location,
          description: data.description,
          contactPerson: data.contactPerson,
          contactPhone: data.contactPhone,
          isDefault: data.isDefault,
        };
        await updateWarehouse(editingWarehouse.id, updateData);
        toast({ title: "Warehouse Updated", description: `${data.name} has been updated.` });
      } else {
        const createData: CreateWarehouseData = {
          name: data.name,
          location: data.location,
          description: data.description,
          contactPerson: data.contactPerson,
          contactPhone: data.contactPhone,
          isDefault: data.isDefault,
          // createdBy will be set by the service
        };
        await addWarehouse(createData, currentUser.uid);
        toast({ title: "Warehouse Added", description: `${data.name} has been added.` });
      }
      setIsDialogOpen(false);
      fetchWarehouses();
    } catch (error: any) {
      console.error("Error saving warehouse:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save warehouse.", variant: "destructive" });
    }
    setIsSubmitting(false);
  };

  if (!canManage && !isLoadingData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>You do not have permission to manage warehouses.</p>
      </div>
    );
  }
  
  const displayedWarehouses = useMemo(() => {
    return showInactive ? warehouses : warehouses.filter(w => w.isActive);
  }, [warehouses, showInactive]);

  return (
    <>
      <PageHeader
        title="Manage Warehouses"
        description="Add, edit, or remove warehouses where your stock is stored."
        actions={
          canManage && (
            <Button onClick={handleAddNew}>
              <Icons.Add className="mr-2 h-4 w-4" /> Add New Warehouse
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="font-headline">Warehouse List</CardTitle>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(checked as boolean)}
              />
              <Label htmlFor="show-inactive">Show Inactive</Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Contact Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={`skeleton-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : displayedWarehouses.length > 0 ? (
                displayedWarehouses.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-medium">{warehouse.name}</TableCell>
                    <TableCell>{warehouse.location || "N/A"}</TableCell>
                    <TableCell>{warehouse.contactPerson}</TableCell>
                    <TableCell>{warehouse.contactPhone}</TableCell>
                    <TableCell>
                      <Badge variant={warehouse.isActive ? "default" : "destructive"} className={warehouse.isActive ? "bg-green-500 text-white hover:bg-green-600" : "hover:bg-red-700"}>
                        {warehouse.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {warehouse.isDefault ? (
                        <Badge variant="default">Default</Badge>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleSetDefault(warehouse.id)} disabled={isSubmitting || !warehouse.isActive}>
                          Set Default
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => handleEdit(warehouse)} disabled={isSubmitting}>
                        <Icons.Edit className="h-4 w-4" />
                      </Button>
                       <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant={warehouse.isActive ? "destructive" : "secondary"}
                            size="sm"
                            disabled={isSubmitting}
                          >
                            {warehouse.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action will {warehouse.isActive ? "deactivate" : "activate"} the warehouse: {warehouse.name}.
                              {!warehouse.isActive && " Activating will make it available for stock operations."}
                              {warehouse.isActive && warehouse.isDefault && " Deactivating a default warehouse is not allowed. Set another as default first."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleToggleActive(warehouse.id, warehouse.isActive)}
                              disabled={warehouse.isActive && warehouse.isDefault}
                            >
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
                    No warehouses found. {canManage && "Get started by adding a new warehouse."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingWarehouse ? "Edit Warehouse" : "Add New Warehouse"}</DialogTitle>
            <DialogDescription>
              {editingWarehouse ? "Make changes to the warehouse details." : "Fill in the details for the new warehouse."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto px-2">
                <div className="space-y-1">
                  <FormLabel htmlFor="name">Name <span className="text-destructive">*</span></FormLabel>
                  <Input id="name" {...form.register("name")} />
                  {form.formState.errors.name && <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>}
                </div>
                <div className="space-y-1">
                  <FormLabel htmlFor="location">Location</FormLabel>
                  <Input id="location" {...form.register("location")} />
                  {form.formState.errors.location && <p className="text-sm text-destructive">{form.formState.errors.location.message}</p>}
                </div>
                 <div className="space-y-1">
                  <FormLabel htmlFor="description">Description</FormLabel>
                  <Textarea id="description" {...form.register("description")} />
                  {form.formState.errors.description && <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>}
                </div>
                <div className="space-y-1">
                  <FormLabel htmlFor="contactPerson">Contact Person <span className="text-destructive">*</span></FormLabel>
                  <Input id="contactPerson" {...form.register("contactPerson")} />
                  {form.formState.errors.contactPerson && <p className="text-sm text-destructive">{form.formState.errors.contactPerson.message}</p>}
                </div>
                <div className="space-y-1">
                  <FormLabel htmlFor="contactPhone">Contact Phone <span className="text-destructive">*</span></FormLabel>
                  <Input id="contactPhone" type="tel" {...form.register("contactPhone")} />
                  {form.formState.errors.contactPhone && <p className="text-sm text-destructive">{form.formState.errors.contactPhone.message}</p>}
                </div>
                 <FormField
                    control={form.control}
                    name="isDefault"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            id="isDefault" 
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel htmlFor="isDefault">Set as Default Warehouse</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            This warehouse will be pre-selected for quick operations. Only one warehouse can be default.
                          </p>
                        </div>
                      </FormItem>
                    )}
                  />
              </div>
              <DialogFooter className="mt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Icons.Logo className="animate-spin" /> : (editingWarehouse ? "Save Changes" : "Add Warehouse")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
