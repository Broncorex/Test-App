
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { createSupplier, isSupplierNameUnique } from "@/services/supplierService";
import type { CreateSupplierData } from "@/services/supplierService";

const supplierFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  contactPerson: z.string().min(2, "Contact person name is required."),
  contactEmail: z.string().email("Invalid email address."),
  contactPhone: z.string().min(7, "Contact phone is required (e.g., 123-4567)."),
  address: z.string().min(5, "Address is required."),
  notes: z.string().optional(), // Notes can be empty
});

type SupplierFormData = z.infer<typeof supplierFormSchema>;

export default function CreateSupplierPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  async function onSubmit(values: SupplierFormData) {
    if (!currentUser?.uid) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    try {
      // Server-side unique name check is also in createSupplier, but good to have client-side too
      if (!await isSupplierNameUnique(values.name)) {
        form.setError("name", { type: "manual", message: "Supplier name must be unique." });
        setIsSubmitting(false);
        return;
      }

      const supplierData: CreateSupplierData = {
        ...values,
        notes: values.notes || "", // Ensure notes is not undefined
      };

      await createSupplier(supplierData, currentUser.uid);
      toast({
        title: "Supplier Created!",
        description: `${values.name} has been successfully added.`,
      });
      router.push("/suppliers");
    } catch (error: any) {
      console.error("Failed to create supplier:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Could not create the supplier. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add New Supplier"
        description="Fill in the details for the new supplier."
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
                      <Input placeholder="e.g., Distributions ABC" {...field} />
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
                      <Input placeholder="John Doe" {...field} />
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
                      <Input type="email" placeholder="contact@supplier.com" {...field} />
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
                      <Input type="tel" placeholder="+1-555-123-4567" {...field} />
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
                      <Textarea placeholder="123 Supplier St, City, Country" {...field} />
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
                      <Textarea placeholder="Additional notes or special agreements..." {...field} />
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
                {isSubmitting ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Add />}
                {isSubmitting ? "Creating..." : "Create Supplier"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
