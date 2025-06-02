
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
import type { Category } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import {
  getAllCategories,
  toggleCategoryActiveStatus,
  getCategoryById,
} from "@/services/categoryService";
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

interface HierarchicalCategory extends Category {
  parentCategoryName?: string;
  depth: number;
}

export default function CategoriesPage() {
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const { role } = useAuth();
  const router = useRouter();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchAllCategoriesForHierarchy = useCallback(async () => {
    if (!canManage) return;
    setIsLoadingData(true);
    try {
      // Fetch ALL categories (active and inactive) to build the complete hierarchy
      // Filtering by `showInactive` will be applied to the final hierarchical list
      const fetchedCategories = await getAllCategories({ filterActive: false, orderBySortOrder: true });
      setAllCategories(fetchedCategories);
    } catch (error) {
      console.error("Error fetching all categories for hierarchy:", error);
      toast({ title: "Error", description: "Failed to fetch category data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, canManage]);

  useEffect(() => {
    fetchAllCategoriesForHierarchy();
  }, [fetchAllCategoriesForHierarchy]);


  const buildHierarchicalList = useCallback((
    categoriesToProcess: Category[],
    parentId: string | null = null,
    depth: number = 0,
    categoryMap: Map<string, Category>
  ): HierarchicalCategory[] => {
    let result: HierarchicalCategory[] = [];
    categoriesToProcess
      .filter(cat => cat.parentCategoryId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .forEach(cat => {
        const parentName = cat.parentCategoryId ? categoryMap.get(cat.parentCategoryId)?.name : "Top-level";
        result.push({ ...cat, depth, parentCategoryName: parentName });
        result = result.concat(buildHierarchicalList(categoriesToProcess, cat.id, depth + 1, categoryMap));
      });
    return result;
  }, []);


  const hierarchicalCategories = useMemo(() => {
    if (isLoadingData || allCategories.length === 0) return [];
    const categoryMap = new Map(allCategories.map(cat => [cat.id, cat]));
    const processed = buildHierarchicalList(allCategories, null, 0, categoryMap);
    
    // Apply active/inactive filter after building hierarchy
    return processed.filter(cat => showInactive ? true : cat.isActive);
  }, [allCategories, isLoadingData, buildHierarchicalList, showInactive]);


  const filteredAndSortedCategories = useMemo(() => {
    if (!searchTerm) {
      return hierarchicalCategories;
    }
    // Simple search: filters the flat list. Hierarchical structure may be disrupted by search.
    // More complex search could try to preserve parent context, but this is simpler.
    return hierarchicalCategories.filter(category => {
      const sTerm = searchTerm.toLowerCase();
      return (
        category.name.toLowerCase().includes(sTerm) ||
        (category.description && category.description.toLowerCase().includes(sTerm)) ||
        (category.parentCategoryName && category.parentCategoryName.toLowerCase().includes(sTerm))
      );
    });
  }, [hierarchicalCategories, searchTerm]);


  const handleToggleActive = async (categoryId: string, currentIsActive: boolean) => {
    if (!canManage) return;
    try {
      await toggleCategoryActiveStatus(categoryId, currentIsActive);
      toast({ title: "Status Updated", description: `Category ${currentIsActive ? "deactivated" : "activated"}.` });
      // Re-fetch all categories to update the list accurately
      fetchAllCategoriesForHierarchy();
    } catch (error: any) {
      console.error("Error toggling category status:", error);
      toast({ title: "Error", description: error.message || "Failed to update status.", variant: "destructive" });
    }
  };
  
  const INDENTATION_UNIT_PX = 20;

  return (
    <>
      <PageHeader
        title="Category Management"
        description="Manage product categories and their hierarchy."
        actions={
          canManage && (
            <Button onClick={() => router.push('/categories/new')}>
              <Icons.Add className="mr-2 h-4 w-4" /> Add New Category
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <CardTitle className="font-headline">Category List</CardTitle>
            <div className="flex items-center gap-4 w-full md:w-auto">
              <Input
                placeholder="Search categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full md:w-64"
              />
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show-inactive-categories"
                  checked={showInactive}
                  onCheckedChange={(checked) => setShowInactive(checked as boolean)}
                />
                <Label htmlFor="show-inactive-categories">Show Inactive</Label>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Name</TableHead>
                <TableHead className="w-[30%]">Description</TableHead>
                <TableHead>Parent Category</TableHead>
                <TableHead className="text-center">Sort Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-category-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-32 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredAndSortedCategories.length > 0 ? (
                filteredAndSortedCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell 
                      className="font-medium"
                      style={{ paddingLeft: `${category.depth * INDENTATION_UNIT_PX}px` }}
                    >
                      {category.depth > 0 && <span className="mr-1 opacity-50">{/* Arrow or marker can go here → */}</span>}
                      {category.name}
                    </TableCell>
                    <TableCell>{category.description}</TableCell>
                    <TableCell>{category.parentCategoryName || "Top-level"}</TableCell>
                    <TableCell className="text-center">{category.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={category.isActive ? "default" : "destructive"} className={category.isActive ? "bg-green-500 text-white hover:bg-green-600" : "hover:bg-red-700"}>
                        {category.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => router.push(`/categories/${category.id}/edit`)}>
                        <Icons.Edit className="h-4 w-4 mr-1" /> Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant={category.isActive ? "destructive" : "secondary"}
                            size="sm"
                          >
                            {category.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action will {category.isActive ? "deactivate" : "activate"} the category: {category.name}.
                              {/* Add warning about child categories or product assignments if implemented later */}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleToggleActive(category.id, category.isActive)}>
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
                  <TableCell colSpan={6} className="h-24 text-center">
                    No categories found. {searchTerm && "Try a different search term or filter."}
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

    