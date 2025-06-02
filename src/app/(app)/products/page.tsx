
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image"; 
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category, Supplier, ProveedorProducto } from "@/types"; 
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth-store";
import { getAllProducts, toggleProductActiveStatus, type ProductFilters } from "@/services/productService";
import { getAllCategories } from "@/services/categoryService";
import { getAllSuppliers } from "@/services/supplierService";
import { getAllSupplierProductsByProduct } from "@/services/supplierProductService"; 
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Timestamp } from "firebase/firestore";
import { Separator } from "@/components/ui/separator"; 

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState<string>("all");
  const [filterSupplierId, setFilterSupplierId] = useState<string>("all");

  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [viewingSupplierProducts, setViewingSupplierProducts] = useState<ProveedorProducto[]>([]); 
  const [isLoadingSupplierProducts, setIsLoadingSupplierProducts] = useState(false); 

  const { toast } = useToast();
  const { role } = useAuth();
  const router = useRouter();

  const canManage = role === 'admin' || role === 'superadmin';

  const fetchInitialData = useCallback(async () => {
    if (!canManage) return;
    setIsLoadingData(true);
    try {
      const [fetchedCategories, fetchedSuppliers] = await Promise.all([
        getAllCategories({ filterActive: true }), 
        getAllSuppliers({ filterActive: true }),
      ]);
      setCategories(fetchedCategories);
      setSuppliers(fetchedSuppliers);

      const productFilters: ProductFilters = {
        filterActive: !showInactive,
        categoryId: filterCategoryId !== "all" ? filterCategoryId : undefined,
        supplierId: filterSupplierId !== "all" ? filterSupplierId : undefined,
        searchQuery: searchTerm || undefined,
      };
      const fetchedProducts = await getAllProducts(productFilters);
      setProducts(fetchedProducts);

    } catch (error) {
      console.error("Error fetching product page data:", error);
      toast({ title: "Error", description: "Failed to fetch product data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [toast, canManage, showInactive, filterCategoryId, filterSupplierId, searchTerm]);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleToggleActive = async (productId: string, currentIsActive: boolean) => {
    if (!canManage) return;
    try {
      await toggleProductActiveStatus(productId, currentIsActive);
      toast({ title: "Status Updated", description: `Product ${currentIsActive ? "deactivated" : "activated"}.` });
      fetchInitialData(); 
    } catch (error: any) {
      console.error("Error toggling product status:", error);
      toast({ title: "Error", description: error.message || "Failed to update status.", variant: "destructive" });
    }
  };

  const getCategoryNames = (categoryIds: string[] | undefined): string => {
    if (!categoryIds || categoryIds.length === 0) return "N/A";
    return categoryIds
      .map(id => categories.find(cat => cat.id === id)?.name || "Unknown")
      .join(", ");
  };

  const getSupplierName = (supplierId: string | undefined): string => {
    if (!supplierId) return "N/A";
    return suppliers.find(sup => sup.id === supplierId)?.name || "Unknown";
  };

  const handleViewDetails = async (product: Product) => {
    // Ensure numeric fields are indeed numbers before setting state for view
    const numericProduct: Product = {
        ...product,
        costPrice: Number(product.costPrice),
        basePrice: Number(product.basePrice),
        sellingPrice: Number(product.sellingPrice),
        discountPercentage: Number(product.discountPercentage || 0),
        discountAmount: Number(product.discountAmount || 0),
        lowStockThreshold: Number(product.lowStockThreshold),
        weight: Number(product.weight),
        dimensions: {
            ...(product.dimensions || {}), // Handle case where dimensions might be missing
            length: Number(product.dimensions?.length || 0),
            width: Number(product.dimensions?.width || 0),
            height: Number(product.dimensions?.height || 0),
            dimensionUnit: product.dimensions?.dimensionUnit || "cm",
        }
    };
    setViewingProduct(numericProduct);
    setIsViewDialogOpen(true);
    setViewingSupplierProducts([]); 
    setIsLoadingSupplierProducts(true);
    try {
      const supProds = await getAllSupplierProductsByProduct(product.id, true); 
      setViewingSupplierProducts(supProds);
    } catch (error) {
      console.error("Error fetching supplier products for view dialog:", error);
      toast({ title: "Error", description: "Could not load supplier pricing details.", variant: "destructive" });
    }
    setIsLoadingSupplierProducts(false);
  };

  const formatTimestamp = (timestamp: Timestamp | string | null | undefined): string => {
    if (!timestamp) return "N/A";
    if (typeof timestamp === 'string') return new Date(timestamp).toLocaleDateString();
    if (timestamp instanceof Timestamp) return timestamp.toDate().toLocaleDateString();
    return "Invalid Date";
  };

  return (
    <>
      <PageHeader
        title="Product Management"
        description="Manage your product catalog, including pricing and availability."
        actions={
          canManage && (
            <Button onClick={() => router.push('/products/new')}>
              <Icons.Add className="mr-2 h-4 w-4" /> Add New Product
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Product List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              placeholder="Search name, SKU, tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Select value={filterCategoryId} onValueChange={setFilterCategoryId}>
              <SelectTrigger><SelectValue placeholder="Filter by Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterSupplierId} onValueChange={setFilterSupplierId}>
              <SelectTrigger><SelectValue placeholder="Filter by Supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {suppliers.map(sup => <SelectItem key={sup.id} value={sup.id}>{sup.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-inactive-products"
                checked={showInactive}
                onCheckedChange={(checked) => setShowInactive(checked as boolean)}
              />
              <Label htmlFor="show-inactive-products">Show Inactive</Label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Image</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Sell Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingData ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-product-${idx}`}>
                    <TableCell><Skeleton className="h-10 w-10 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : products.length > 0 ? (
                products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="w-10 h-10 relative rounded overflow-hidden border" data-ai-hint="product thumbnail">
                        <Image
                          src={product.imageUrl || "https://placehold.co/100x100.png?text=N/A"}
                          alt={product.name}
                          layout="fill"
                          objectFit="cover"
                          onError={(e) => { (e.target as HTMLImageElement).src = "https://placehold.co/100x100.png?text=Error"; }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{getCategoryNames(product.categoryIds)}</TableCell>
                    <TableCell>{getSupplierName(product.supplierId)}</TableCell>
                    <TableCell className="text-right">${Number(product.sellingPrice || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={product.isActive ? "default" : "destructive"} className={product.isActive ? "bg-green-500 text-white hover:bg-green-600" : "hover:bg-red-700"}>
                        {product.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="outline" size="sm" onClick={() => handleViewDetails(product)}>
                        <Icons.View className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => router.push(`/products/${product.id}/edit`)}>
                        <Icons.Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant={product.isActive ? "destructive" : "secondary"} size="sm">
                           {product.isActive ? <Icons.Delete className="h-4 w-4" /> : <Icons.Package className="h-4 w-4" />}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action will {product.isActive ? "deactivate" : "activate"} the product: {product.name}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleToggleActive(product.id, product.isActive)}>
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
                  <TableCell colSpan={8} className="h-24 text-center">
                    No products found. { (searchTerm || filterCategoryId !== "all" || filterSupplierId !== "all") && "Try adjusting your search or filters."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {viewingProduct && (
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="sm:max-w-2xl md:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="font-headline text-2xl">{viewingProduct.name}</DialogTitle>
              <DialogDescription>SKU: {viewingProduct.sku}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] p-1 pr-3">
              <div className="space-y-6 py-4">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-full md:w-1/3 flex-shrink-0 relative aspect-square rounded-lg overflow-hidden border shadow-md" data-ai-hint="product detail photo">
                    <Image
                      src={viewingProduct.imageUrl || "https://placehold.co/400x400.png?text=N/A"}
                      alt={viewingProduct.name}
                      layout="fill"
                      objectFit="cover"
                       onError={(e) => { (e.target as HTMLImageElement).src = "https://placehold.co/400x400.png?text=Error"; }}
                    />
                  </div>
                  <div className="w-full md:w-2/3 space-y-3">
                    <div>
                      <Label className="text-sm font-semibold text-muted-foreground">Description</Label>
                      <p className="text-sm">{viewingProduct.description}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-semibold text-muted-foreground">Barcode</Label>
                      <p className="text-sm">{viewingProduct.barcode}</p>
                    </div>
                     <div>
                      <Label className="text-sm font-semibold text-muted-foreground">Tags</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {viewingProduct.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div><Label className="text-xs font-semibold text-muted-foreground">Categories</Label><p className="text-sm">{getCategoryNames(viewingProduct.categoryIds)}</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Primary Supplier</Label><p className="text-sm">{getSupplierName(viewingProduct.supplierId)}</p></div>
                  
                  <div><Label className="text-xs font-semibold text-muted-foreground">Cost Price</Label><p className="text-sm">${Number(viewingProduct.costPrice).toFixed(2)}</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Base Price</Label><p className="text-sm">${Number(viewingProduct.basePrice).toFixed(2)}</p></div>
                  
                  <div><Label className="text-xs font-semibold text-muted-foreground">Discount %</Label><p className="text-sm">{Number(viewingProduct.discountPercentage || 0)}%</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Discount Amount</Label><p className="text-sm">${Number(viewingProduct.discountAmount || 0).toFixed(2)}</p></div>
                  
                  <div><Label className="text-xs font-semibold text-muted-foreground">Selling Price</Label><p className="text-sm font-bold text-primary">${Number(viewingProduct.sellingPrice).toFixed(2)}</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Low Stock Threshold</Label><p className="text-sm">{Number(viewingProduct.lowStockThreshold)}</p></div>

                  <div><Label className="text-xs font-semibold text-muted-foreground">Weight</Label><p className="text-sm">{Number(viewingProduct.weight)} kg</p></div>
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground">Dimensions (LxWxH)</Label>
                    <p className="text-sm">
                      {Number(viewingProduct.dimensions.length)} x {Number(viewingProduct.dimensions.width)} x {Number(viewingProduct.dimensions.height)} {viewingProduct.dimensions.dimensionUnit || ""}
                    </p>
                  </div>
                   <div><Label className="text-xs font-semibold text-muted-foreground">Unit of Measure</Label><p className="text-sm">{viewingProduct.unitOfMeasure || "N/A"}</p></div>

                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground">Status</Label>
                    <div>
                        <Badge variant={viewingProduct.isActive ? "default" : "destructive"} className={viewingProduct.isActive ? "bg-green-500 text-white" : ""}>{viewingProduct.isActive ? "Active" : "Inactive"}</Badge>
                    </div>
                  </div>
                   <div>
                    <Label className="text-xs font-semibold text-muted-foreground">Available for Sale</Label>
                    <div>
                        <Badge variant={viewingProduct.isAvailableForSale ? "default" : "secondary"} className={viewingProduct.isAvailableForSale ? "bg-green-500 text-white" : ""}>{viewingProduct.isAvailableForSale ? "Yes" : "No"}</Badge>
                    </div>
                  </div>

                  <div><Label className="text-xs font-semibold text-muted-foreground">Promotion Start</Label><p className="text-sm">{formatTimestamp(viewingProduct.promotionStartDate)}</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Promotion End</Label><p className="text-sm">{formatTimestamp(viewingProduct.promotionEndDate)}</p></div>
                  
                  <div><Label className="text-xs font-semibold text-muted-foreground">Created At</Label><p className="text-sm">{formatTimestamp(viewingProduct.createdAt)}</p></div>
                  <div><Label className="text-xs font-semibold text-muted-foreground">Last Updated</Label><p className="text-sm">{formatTimestamp(viewingProduct.updatedAt)}</p></div>
                   <div><Label className="text-xs font-semibold text-muted-foreground">Created By (UID)</Label><p className="text-sm">{viewingProduct.createdBy || "N/A"}</p></div>
                </div>

                <Separator className="my-4" />
                <div>
                  <h3 className="text-lg font-semibold mb-3 text-foreground">Additional Supplier Pricing</h3>
                  {isLoadingSupplierProducts ? (
                    <div className="space-y-2">
                      <Skeleton className="h-20 w-full rounded-md" />
                      <Skeleton className="h-20 w-full rounded-md" />
                    </div>
                  ) : viewingSupplierProducts.length > 0 ? (
                    <div className="space-y-3">
                      {viewingSupplierProducts.map((sp) => {
                        const supplierDetails = suppliers.find(s => s.id === sp.supplierId);
                        return (
                          <Card key={sp.id} className="p-3 bg-muted/20 shadow-sm border">
                            <div className="flex justify-between items-start mb-1">
                              <div>
                                <p className="font-semibold text-md text-primary">
                                  {supplierDetails?.name || sp.supplierId}
                                </p>
                                <p className="text-xs text-muted-foreground">Supplier SKU: {sp.supplierSku}</p>
                              </div>
                              <div className="text-right">
                                {!sp.isActive && <Badge variant="outline" className="ml-2 text-xs mb-1">Link Inactive</Badge>}
                                <Badge variant={sp.isAvailable ? "default" : "secondary"} className={sp.isAvailable ? "bg-green-100 text-green-700 border-green-300" : "bg-red-100 text-red-700 border-red-300"}>
                                  {sp.isAvailable ? "Available" : "Unavailable"}
                                </Badge>
                              </div>
                            </div>
                            {sp.notes && <p className="text-xs mt-1 mb-2 italic">Notes: {sp.notes}</p>}
                            <div className="mt-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Price Ranges:</p>
                              {sp.priceRanges.length > 0 ? (
                                <ul className="list-none pl-0 space-y-0.5">
                                  {sp.priceRanges.map((pr, index) => (
                                    <li key={index} className="text-xs flex justify-between border-b border-dashed border-border/50 py-0.5">
                                      <span>
                                        Qty: {Number(pr.minQuantity)}
                                        {pr.maxQuantity ? `-${Number(pr.maxQuantity)}` : '+'}
                                        {pr.additionalConditions && <span className="text-muted-foreground text-[11px]"> ({pr.additionalConditions})</span>}
                                      </span>
                                      <span className="font-medium">
                                        {pr.priceType === 'fixed' && pr.price !== null ? `$${Number(pr.price).toFixed(2)}` : pr.priceType}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-muted-foreground">No price ranges defined.</p>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">Last Price Update: {formatTimestamp(sp.lastPriceUpdate)}</p>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No additional supplier pricing linked for this product.</p>
                  )}
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

