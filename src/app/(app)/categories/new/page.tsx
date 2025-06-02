
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
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
import { useAuth } from "@/hooks/use-auth-store";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { createCategory, getAllCategories } from "@/services/categoryService";
import type { CreateCategoryData, Category } from "@/types";

const NO_PARENT_ID_VALUE = "__NONE__"; // Special value for "None (Top-level)"

const categoryFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  description: z.string().min(5, "Description must be at least 5 characters."),
  parentCategoryId: z.string().optional(), // Can be string ID or special value
  sortOrder: z.coerce.number().int().min(0, "Sort order must be a non-negative integer."),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

export default function CreateCategoryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableParentCategories, setAvailableParentCategories] = useState<Category[]>([]);
  const [isLoadingParents, setIsLoadingParents] = useState(true);

  useEffect(() => {
    async function fetchParentCategories() {
      setIsLoadingParents(true);
      try {
        const activeCategories = await getAllCategories({ filterActive: true, orderBySortOrder: true });
        setAvailableParentCategories(activeCategories);
      } catch (error) {
        console.error("Failed to fetch parent categories:", error);
        toast({ title: "Error", description: "Could not load parent categories.", variant: "destructive" });
      }
      setIsLoadingParents(false);
    }
    fetchParentCategories();
  }, [toast]);

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      description: "",
      parentCategoryId: NO_PARENT_ID_VALUE,
      sortOrder: 0,
    },
  });

  async function onSubmit(values: CategoryFormData) {
    if (!currentUser?.uid) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const actualParentId = values.parentCategoryId === NO_PARENT_ID_VALUE ? null : values.parentCategoryId;

    try {
      const categoryData: CreateCategoryData = {
        name: values.name,
        description: values.description,
        parentCategoryId: actualParentId!, 
        sortOrder: values.sortOrder,
      };

      await createCategory(categoryData, currentUser.uid);
      toast({
        title: "Category Created!",
        description: `${values.name} has been successfully added.`,
      });
      router.push("/categories");
    } catch (error: any) {
      console.error("Failed to create category:", error);
      toast({
        title: "Creation Failed",
        description: error.message || "Could not create the category. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Add New Category"
        description="Fill in the details for the new product category."
      />
      <Card className="w-full max-w-2xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Category Information</CardTitle>
              <CardDescription>All fields marked with * are required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Electronics" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description *</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Describe the category..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="parentCategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent Category</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value}
                      disabled={isLoadingParents}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={isLoadingParents ? "Loading..." : "Select parent category"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_PARENT_ID_VALUE}>None (Top-level category)</SelectItem>
                        {availableParentCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
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
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order *</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="0" {...field} />
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
              <Button type="submit" disabled={isSubmitting || isLoadingParents}>
                {isSubmitting ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Add />}
                {isSubmitting ? "Creating..." : "Create Category"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
