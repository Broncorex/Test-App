
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth-store";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { getSupplierById, updateSupplier, isSupplierNameUnique } from "@/services/supplierService";
import type { UpdateSupplierData } from "@/services/supplierService";
import type { Supplier } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

const supplierFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  contactPerson: z.string().min(2, "Contact person name is required."),
  contactEmail: z.string().email("Invalid email address."),
  contactPhone: z.string().min(7, "Contact phone is required (e.g., 123-4567)."),
  address: z.string().min(5, "Address is required."),
  notes: z.string().optional(),
});

type SupplierFormData = z.infer<typeof supplierFormSchema>;

export default function EditSupplierPage() {
  const router = useRouter();
  const params = useParams();
  const supplierId = params.id as string;

  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [supplier, setSupplier] = useState<Supplier | null>(null);

  const form = useForm<SupplierFormData>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: "",
      contactPerson: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
      notes: "",
    },
  });

  const fetchSupplierData = useCallback(async () => {
    if (!supplierId) return;
    setIsLoadingData(true);
    try {
      const fetchedSupplier = await getSupplierById(supplierId);
      if (fetchedSupplier) {
        setSupplier(fetchedSupplier);
        form.reset({
          name: fetchedSupplier.name,
          contactPerson: fetchedSupplier.contactPerson,
          contactEmail: fetchedSupplier.contactEmail,
          contactPhone: fetchedSupplier.contactPhone,
          address: fetchedSupplier.address,
          notes: fetchedSupplier.notes || "",
        });
      } else {
        toast({ title: "Error", description: "Supplier not found.", variant: "destructive" });
        router.replace("/suppliers");
      }
    } catch (error) {
      console.error("Failed to fetch supplier:", error);
      toast({ title: "Error", description: "Could not load supplier data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [supplierId, form, toast, router]);

  useEffect(() => {
    fetchSupplierData();
  }, [fetchSupplierData]);

  async function onSubmit(values: SupplierFormData) {
    if (!currentUser?.uid || !supplier) {
      toast({ title: "Error", description: "User not authenticated or supplier data missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    try {
      if (values.name !== supplier.name && !await isSupplierNameUnique(values.name, supplierId)) {
        form.setError("name", { type: "manual", message: "Supplier name must be unique." });
        setIsSubmitting(false);
        return;
      }

      const supplierData: UpdateSupplierData = {
        ...values,
        notes: values.notes || "",
      };

      await updateSupplier(supplierId, supplierData);
      toast({
        title: "Supplier Updated!",
        description: `${values.name} has been successfully updated.`,
      });
      router.push("/suppliers");
    } catch (error: any) {
      console.error("Failed to update supplier:", error);
      toast({
        title: "Update Failed",
        description: error.message || "Could not update the supplier. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingData) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit Supplier" description="Loading supplier details..." />
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
          <CardContent className="space-y-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
          <CardFooter><Skeleton className="h-10 w-24 ml-auto" /></CardFooter>
        </Card>
      </div>
    );
  }

  if (!supplier) {
     return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Supplier not found or an error occurred.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit Supplier: ${supplier.name}`}
        description="Update the supplier's information."
      />
      <Card className="w-full max-w-2xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Supplier Information</CardTitle>
              <CardDescription>All fields marked with * are required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier Name *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person *</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Email *</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Phone *</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address *</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Edit />}
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
