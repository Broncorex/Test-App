
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
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
import { getCategoryById, updateCategory, getAllCategories } from "@/services/categoryService";
import type { UpdateCategoryData, Category } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

const NO_PARENT_ID_VALUE = "__NONE__";

const categoryFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  description: z.string().min(5, "Description must be at least 5 characters."),
  parentCategoryId: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0, "Sort order must be a non-negative integer."),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

export default function EditCategoryPage() {
  const router = useRouter();
  const params = useParams();
  const categoryId = params.id as string;

  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [category, setCategory] = useState<Category | null>(null);
  const [availableParentCategories, setAvailableParentCategories] = useState<Category[]>([]);
  const [isLoadingParents, setIsLoadingParents] = useState(true);

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      description: "",
      parentCategoryId: NO_PARENT_ID_VALUE,
      sortOrder: 0,
    },
  });

  const fetchCategoryData = useCallback(async () => {
    if (!categoryId) return;
    setIsLoadingData(true);
    setIsLoadingParents(true);
    try {
      const fetchedCategory = await getCategoryById(categoryId);
      if (fetchedCategory) {
        setCategory(fetchedCategory);
        form.reset({
          name: fetchedCategory.name,
          description: fetchedCategory.description,
          parentCategoryId: fetchedCategory.parentCategoryId || NO_PARENT_ID_VALUE,
          sortOrder: fetchedCategory.sortOrder,
        });
        
        const activeCategories = await getAllCategories({ filterActive: true, orderBySortOrder: true });
        // Filter out the current category and its descendants to prevent circular dependencies
        // Simple filter: exclude self. More complex descendant filtering can be added.
        setAvailableParentCategories(activeCategories.filter(cat => cat.id !== categoryId));

      } else {
        toast({ title: "Error", description: "Category not found.", variant: "destructive" });
        router.replace("/categories");
      }
    } catch (error) {
      console.error("Failed to fetch category:", error);
      toast({ title: "Error", description: "Could not load category data.", variant: "destructive" });
    }
    setIsLoadingData(false);
    setIsLoadingParents(false);
  }, [categoryId, form, toast, router]);

  useEffect(() => {
    fetchCategoryData();
  }, [fetchCategoryData]);

  async function onSubmit(values: CategoryFormData) {
    if (!currentUser?.uid || !category) {
      toast({ title: "Error", description: "User not authenticated or category data missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);

    const actualParentId = values.parentCategoryId === NO_PARENT_ID_VALUE ? null : values.parentCategoryId;

    if (actualParentId === categoryId) {
      form.setError("parentCategoryId", { type: "manual", message: "A category cannot be its own parent." });
      setIsSubmitting(false);
      return;
    }

    try {
      const categoryData: UpdateCategoryData = {
        name: values.name,
        description: values.description,
        parentCategoryId: actualParentId!,
        sortOrder: values.sortOrder,
      };

      await updateCategory(categoryId, categoryData);
      toast({
        title: "Category Updated!",
        description: `${values.name} has been successfully updated.`,
      });
      router.push("/categories");
    } catch (error: any) {
      console.error("Failed to update category:", error);
      toast({
        title: "Update Failed",
        description: error.message || "Could not update the category. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingData || !category) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit Category" description="Loading category details..." />
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
          <CardContent className="space-y-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
          <CardFooter><Skeleton className="h-10 w-24 ml-auto" /></CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit Category: ${category.name}`}
        description="Update the category's information."
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
                      <Input {...field} />
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
                      <Textarea {...field} />
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
                      value={field.value}
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
                          <SelectItem key={cat.id} value={cat.id} disabled={cat.id === categoryId}>
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
                      <Input type="number" {...field} />
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
