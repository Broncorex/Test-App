"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

// Mock data - replace with actual data fetching
const mockProducts = [
  { id: "prod_1", name: "Laptop Pro 15" },
  { id: "prod_2", name: "Wireless Mouse" },
  { id: "prod_3", name: "Mechanical Keyboard" },
  { id: "prod_4", name: "4K Monitor 27" },
];

const mockWarehouses = [
  { id: "wh_1", name: "Main Warehouse (New York)" },
  { id: "wh_2", name: "West Coast Hub (Los Angeles)" },
  { id: "wh_3", name: "Central Depot (Chicago)" },
];

const registerStockSchema = z.object({
  productId: z.string().min(1, "Product is required."),
  warehouseId: z.string().min(1, "Warehouse is required."),
  quantity: z.coerce.number().min(1, "Quantity must be at least 1."),
  type: z.enum(["inbound", "outbound", "adjustment"], {
    required_error: "Movement type is required.",
  }),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid date format.",
  }),
  notes: z.string().optional(),
});

export default function RegisterStockPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof registerStockSchema>>({
    resolver: zodResolver(registerStockSchema),
    defaultValues: {
      productId: "",
      warehouseId: "",
      quantity: 1,
      type: undefined,
      date: new Date().toISOString().split("T")[0], // Default to today
      notes: "",
    },
  });

  async function onSubmit(values: z.infer<typeof registerStockSchema>) {
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log("Stock Movement Data:", values);
    toast({
      title: "Stock Registered!",
      description: `${values.quantity} units of product moved (${values.type}).`,
      variant: "default",
    });
    form.reset();
    setIsSubmitting(false);
  }

  return (
    <>
      <PageHeader
        title="Register Stock Movement"
        description="Record inbound, outbound, or stock adjustments."
      />
      <Card className="max-w-2xl mx-auto shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">New Stock Entry</CardTitle>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a product" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {mockProducts.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="warehouseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a warehouse" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {mockWarehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Movement Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="inbound">Inbound</SelectItem>
                          <SelectItem value="outbound">Outbound</SelectItem>
                          <SelectItem value="adjustment">Adjustment</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of Movement</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
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
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any relevant notes, e.g., supplier, reason for adjustment."
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full md:w-auto" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Icons.Logo className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Icons.RegisterStock className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? "Submitting..." : "Register Movement"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
