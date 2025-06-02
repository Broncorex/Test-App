
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth-store.tsx";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { createRequisition, type CreateRequisitionData, type RequisitionProductData } from "@/services/requisitionService";
import { getAllProducts, type ProductFilters } from "@/services/productService";
import type { Product } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const requiredProductSchema = z.object({
  productId: z.string().min(1, "Product selection is required."),
  productName: z.string(), // Will be set based on productId, not directly by user
  requiredQuantity: z.coerce.number().min(1, "Quantity must be at least 1."),
  notes: z.string().optional(),
});

const requisitionFormSchema = z.object({
  notes: z.string().min(5, "Overall notes must be at least 5 characters."),
  products: z.array(requiredProductSchema).min(1, "At least one product must be added to the requisition."),
});

type RequisitionFormData = z.infer<typeof requisitionFormSchema>;

export default function CreateRequisitionPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser, userName: currentUserName, isLoading: authIsLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);

  const form = useForm<RequisitionFormData>({
    resolver: zodResolver(requisitionFormSchema),
    defaultValues: {
      notes: "",
      products: [{ productId: "", productName: "", requiredQuantity: 1, notes: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "products",
  });

  useEffect(() => {
    async function fetchProducts() {
      setIsLoadingProducts(true);
      try {
        // Fetch only active and available for sale products
        const filters: ProductFilters = { filterActive: true, filterAvailableForSale: true };
        const products = await getAllProducts(filters);
        setAvailableProducts(products);
      } catch (error) {
        console.error("Failed to fetch products:", error);
        toast({ title: "Error", description: "Could not load products for selection.", variant: "destructive" });
      }
      setIsLoadingProducts(false);
    }
    fetchProducts();
  }, [toast]);

  const handleProductChange = (index: number, productId: string) => {
    const selectedProduct = availableProducts.find(p => p.id === productId);
    if (selectedProduct) {
      form.setValue(`products.${index}.productName`, selectedProduct.name, { shouldValidate: true });
      form.setValue(`products.${index}.productId`, productId, { shouldValidate: true });
    }
  };

  async function onSubmit(values: RequisitionFormData) {
    if (!currentUser?.uid || !currentUserName) {
      toast({ title: "Error", description: "User not authenticated or user name missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const requisitionData: CreateRequisitionData = {
      notes: values.notes,
      products: values.products.map(p => ({
        productId: p.productId,
        productName: p.productName, // Already set by handleProductChange
        requiredQuantity: p.requiredQuantity,
        notes: p.notes || "",
      })),
    };

    try {
      await createRequisition(requisitionData, currentUser.uid, currentUserName);
      toast({
        title: "Requisition Created!",
        description: "Your purchase requisition has been successfully submitted.",
      });
      form.reset();
      router.push("/requisitions"); 
    } catch (error: any) {
      console.error("Failed to create requisition:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Could not create the requisition. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }
  
  if (authIsLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p>Loading user data...</p></div>;
  }

  return (
    <>
      <PageHeader
        title="Create New Requisition"
        description="Specify the products and quantities you need to procure."
      />
      <Card className="w-full max-w-3xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Requisition Details</CardTitle>
              <CardDescription>Fill in the overall notes and add the required products.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Overall Notes *</FormLabel>
                    <FormControl>
                      <Textarea placeholder="e.g., Reason for requisition, desired delivery timeframe, project code" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />
              <h3 className="text-lg font-semibold">Required Products *</h3>
              {fields.map((item, index) => (
                <Card key={item.id} className="p-4 space-y-3 relative bg-muted/30">
                   {fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 text-destructive hover:bg-destructive/10"
                      onClick={() => remove(index)}
                    >
                      <Icons.Delete className="h-4 w-4" />
                      <span className="sr-only">Remove item</span>
                    </Button>
                  )}
                  <FormField
                    control={form.control}
                    name={`products.${index}.productId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product *</FormLabel>
                        <Select
                          onValueChange={(value) => handleProductChange(index, value)}
                          defaultValue={field.value}
                          disabled={isLoadingProducts}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={isLoadingProducts ? "Loading products..." : "Select a product"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableProducts.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name} (SKU: {product.sku})
                              </SelectItem>
                            ))}
                            {availableProducts.length === 0 && !isLoadingProducts && <p className="p-2 text-sm text-muted-foreground">No active products available.</p>}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`products.${index}.requiredQuantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Required Quantity *</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`products.${index}.notes`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder="e.g., Specific brand, urgent need" {...field} rows={2} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Card>
              ))}
               {form.formState.errors.products && typeof form.formState.errors.products.message === 'string' && (
                <p className="text-sm font-medium text-destructive">{form.formState.errors.products.message}</p>
              )}
               {form.formState.errors.products?.root && (
                <p className="text-sm font-medium text-destructive">{form.formState.errors.products.root.message}</p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ productId: "", productName: "", requiredQuantity: 1, notes: "" })}
                disabled={isLoadingProducts}
              >
                <Icons.Add className="mr-2 h-4 w-4" /> Add Product
              </Button>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || isLoadingProducts}>
                {isSubmitting ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Send />}
                {isSubmitting ? "Submitting..." : "Submit Requisition"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
