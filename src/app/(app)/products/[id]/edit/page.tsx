
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Timestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject, type StorageError } from "firebase/storage";
import Image from "next/image";

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
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth-store.tsx";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { getProductById, updateProduct, calculateSellingPrice, type UpdateProductData } from "@/services/productService";
import { getAllCategories } from "@/services/categoryService";
import { getAllSuppliers } from "@/services/supplierService";
import type { Product, Category, Supplier } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { storage } from "@/lib/firebase";
import { Progress } from "@/components/ui/progress";

const dimensionUnits = ["cm", "m", "in", "mm", "ft"];

const productFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  description: z.string().min(5, "Description must be at least 5 characters."),
  basePrice: z.coerce.number().min(0, "Base price must be non-negative."),
  discountPercentage: z.coerce.number().min(0).max(100).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  unitOfMeasure: z.string().optional(),
  categoryIds: z.array(z.string()).min(1, "At least one category is required."),
  isAvailableForSale: z.boolean().default(true),
  promotionStartDate: z.string().nullable().optional(),
  promotionEndDate: z.string().nullable().optional(),
  imageUrl: z.string().url("A valid image URL is required.").min(1, "Image URL is required."),
  tags: z.string().min(1, "At least one tag is required (comma-separated)."),
  lowStockThreshold: z.coerce.number().int().min(0, "Low stock threshold must be a non-negative integer."),
  supplierId: z.string().min(1, "Primary supplier is required."),
  barcode: z.string().min(1, "Barcode is required."),
  weight: z.coerce.number().min(0.001, "Weight must be positive."),
  dimensions_length: z.coerce.number().min(0.01, "Length must be positive."),
  dimensions_width: z.coerce.number().min(0.01, "Width must be positive."),
  dimensions_height: z.coerce.number().min(0.01, "Height must be positive."),
  dimensions_unit: z.string().optional(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

const formatDateForInput = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp) return "";
  return timestamp.toDate().toISOString().split('T')[0];
};

const getDimensionValue = (nestedVal: number | undefined, flatValStr: string | undefined): number => {
    if (typeof nestedVal === 'number' && !isNaN(nestedVal)) {
        return nestedVal;
    }
    if (typeof flatValStr === 'string') {
        const num = parseFloat(flatValStr);
        if (!isNaN(num)) {
            return num;
        }
    }
    if (typeof flatValStr === 'number' && !isNaN(flatValStr)) {
        return flatValStr;
    }
    return 0; 
};


export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingDeps, setIsLoadingDeps] = useState(true);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
  });

  const { watch, reset, setValue, setError, clearErrors } = form;
  const watchedBasePrice = watch("basePrice");
  const watchedDiscountPercentage = watch("discountPercentage");
  const watchedDiscountAmount = watch("discountAmount");

  const calculatedSellingPrice = useMemo(() => {
    return calculateSellingPrice(
      watchedBasePrice || 0,
      watchedDiscountPercentage || 0,
      watchedDiscountAmount || 0
    );
  }, [watchedBasePrice, watchedDiscountPercentage, watchedDiscountAmount]);

  const fetchProductAndDepsData = useCallback(async () => {
    if (!productId) return;
    setIsLoadingData(true);
    setIsLoadingDeps(true);
    try {
      const [fetchedProduct, fetchedCategories, fetchedSuppliers] = await Promise.all([
        getProductById(productId),
        getAllCategories({ filterActive: true, orderBySortOrder: true }),
        getAllSuppliers({ filterActive: true }),
      ]);

      setCategories(fetchedCategories);
      setSuppliers(fetchedSuppliers);
      setIsLoadingDeps(false);

      if (fetchedProduct) {
        setProduct(fetchedProduct);
        setCurrentImageUrl(fetchedProduct.imageUrl);
        
        const flatProductData = fetchedProduct as any;

        reset({
          name: fetchedProduct.name,
          description: fetchedProduct.description,
          basePrice: fetchedProduct.basePrice,
          discountPercentage: fetchedProduct.discountPercentage || 0,
          discountAmount: fetchedProduct.discountAmount || 0,
          unitOfMeasure: fetchedProduct.unitOfMeasure || "",
          categoryIds: fetchedProduct.categoryIds || [],
          isAvailableForSale: fetchedProduct.isAvailableForSale,
          promotionStartDate: formatDateForInput(fetchedProduct.promotionStartDate),
          promotionEndDate: formatDateForInput(fetchedProduct.promotionEndDate),
          imageUrl: fetchedProduct.imageUrl,
          tags: (fetchedProduct.tags || []).join(", "),
          lowStockThreshold: fetchedProduct.lowStockThreshold,
          supplierId: fetchedProduct.supplierId,
          barcode: fetchedProduct.barcode,
          weight: fetchedProduct.weight,
          dimensions_length: getDimensionValue(fetchedProduct.dimensions?.length, flatProductData.dimensions_length),
          dimensions_width: getDimensionValue(fetchedProduct.dimensions?.width, flatProductData.dimensions_width),
          dimensions_height: getDimensionValue(fetchedProduct.dimensions?.height, flatProductData.dimensions_height),
          dimensions_unit: fetchedProduct.dimensions?.dimensionUnit || flatProductData.dimensions_unit || "cm",
        });
      } else {
        toast({ title: "Error", description: "Product not found.", variant: "destructive" });
        router.replace("/products");
      }
    } catch (error) {
      console.error("Failed to fetch product data or dependencies:", error);
      toast({ title: "Error", description: "Could not load product data.", variant: "destructive" });
    }
    setIsLoadingData(false);
  }, [productId, reset, toast, router]);

  useEffect(() => {
    fetchProductAndDepsData();
  }, [fetchProductAndDepsData]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      clearErrors("imageUrl");
      setValue("imageUrl", ""); 
    } else {
      setImageFile(null);
      setImagePreview(null);
      if (product) {
        setValue("imageUrl", product.imageUrl);
      }
    }
  };

  async function onSubmit(values: ProductFormData) {
    if (!currentUser?.uid || !product) {
      toast({ title: "Error", description: "User not authenticated or product data missing.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    let finalImageUrl = values.imageUrl;

    if (imageFile) {
      setIsUploading(true);
      setUploadProgress(0);
      const newImageStorageRef = ref(storage, `products_images/${Date.now()}_${imageFile.name}`);
      const uploadTask = uploadBytesResumable(newImageStorageRef, imageFile);

      try {
        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (error: StorageError) => {
              console.error("New image upload error:", error);
              toast({ title: "Image Upload Failed", description: error.message, variant: "destructive" });
              setIsUploading(false);
              setUploadProgress(null);
              reject(error);
            },
            async () => {
              finalImageUrl = await getDownloadURL(uploadTask.snapshot.ref);
              setValue("imageUrl", finalImageUrl);

              if (currentImageUrl && currentImageUrl !== finalImageUrl && !currentImageUrl.startsWith("https://placehold.co")) {
                try {
                  const oldImageRef = ref(storage, currentImageUrl);
                  await deleteObject(oldImageRef);
                } catch (deleteError: any) {
                  console.warn("Failed to delete old product image:", deleteError.message);
                }
              }
              setCurrentImageUrl(finalImageUrl);
              setIsUploading(false);
              setUploadProgress(null);
              setImageFile(null);
              setImagePreview(null);
              resolve();
            }
          );
        });
      } catch (error) {
        setIsSubmitting(false);
        return;
      }
    }

    if (!finalImageUrl || finalImageUrl.trim() === "") {
        setError("imageUrl", {
            type: "manual",
            message: "Product image is required. Please upload or ensure an image URL is present."
        });
        setIsSubmitting(false);
        setIsUploading(false);
        return;
    }

    try {
      const productData: UpdateProductData = {
        name: values.name,
        description: values.description,
        basePrice: values.basePrice,
        discountPercentage: values.discountPercentage,
        discountAmount: values.discountAmount,
        unitOfMeasure: values.unitOfMeasure,
        categoryIds: values.categoryIds,
        isAvailableForSale: values.isAvailableForSale,
        promotionStartDate: values.promotionStartDate ? Timestamp.fromDate(new Date(values.promotionStartDate)) : null,
        promotionEndDate: values.promotionEndDate ? Timestamp.fromDate(new Date(values.promotionEndDate)) : null,
        imageUrl: finalImageUrl,
        tags: values.tags.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0),
        lowStockThreshold: values.lowStockThreshold,
        supplierId: values.supplierId,
        barcode: values.barcode,
        weight: values.weight,
        dimensions: {
          length: values.dimensions_length,
          width: values.dimensions_width,
          height: values.dimensions_height,
          dimensionUnit: values.dimensions_unit,
        }
      };

      await updateProduct(productId, productData);
      toast({
        title: "Product Updated!",
        description: `${values.name} has been successfully updated.`,
      });
      router.push("/products");
    } catch (error: any) {
      console.error("Failed to update product:", error);
      toast({
        title: "Update Failed",
        description: error.message || "Could not update the product. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  }

  if (isLoadingData || !product) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit Product" description="Loading product details..." />
        <Card className="w-full max-w-3xl mx-auto">
          <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
          <CardContent className="space-y-6">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
          <CardFooter><Skeleton className="h-10 w-24 ml-auto" /></CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit Product: ${product.name}`}
        description="Update the product's information. Cost price is updated via receipts."
      />
      <Card className="w-full max-w-3xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Product Information (SKU: {product.sku})</CardTitle>
              <CardDescription>Fields marked with * are required. Selling price is calculated automatically. Cost price is read-only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Product Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormItem><FormLabel>SKU (Read-only)</FormLabel><FormControl><Input value={product.sku} readOnly disabled /></FormControl></FormItem>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="barcode" render={({ field }) => (
                <FormItem><FormLabel>Barcode *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />

               <FormField control={form.control} name="categoryIds" render={() => (
                <FormItem>
                  <FormLabel>Categories *</FormLabel>
                  {isLoadingDeps ? <p>Loading categories...</p> : categories.length === 0 ? <p>No active categories available.</p> : (
                  <ScrollArea className="h-40 rounded-md border p-2">
                    {categories.map((category) => (
                      <FormField key={category.id} control={form.control} name="categoryIds"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0 py-1">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(category.id)}
                                onCheckedChange={(checked) => {
                                  const currentCategoryIds = field.value || [];
                                  return checked
                                    ? field.onChange([...currentCategoryIds, category.id])
                                    : field.onChange(currentCategoryIds.filter(id => id !== category.id));
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal">{category.name}</FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </ScrollArea>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              
              <FormField control={form.control} name="supplierId" render={({ field }) => (
                <FormItem><FormLabel>Primary Supplier *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingDeps}>
                    <FormControl><SelectTrigger><SelectValue placeholder={isLoadingDeps ? "Loading..." : "Select a supplier"} /></SelectTrigger></FormControl>
                    <SelectContent>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />

              <FormItem>
                <FormLabel>Cost Price (Read-only)</FormLabel>
                <FormControl>
                  <Input type="number" value={product.costPrice} readOnly disabled className="text-muted-foreground" />
                </FormControl>
                <p className="text-xs text-muted-foreground">Updated automatically via stock receipts.</p>
              </FormItem>
              <FormField control={form.control} name="basePrice" render={({ field }) => (
                <FormItem><FormLabel>Base Price *</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="discountPercentage" render={({ field }) => (
                  <FormItem><FormLabel>Discount % (0-100)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="discountAmount" render={({ field }) => (
                  <FormItem><FormLabel>Discount Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormItem>
                <FormLabel>Calculated Selling Price</FormLabel>
                <Input type="text" value={`$${calculatedSellingPrice.toFixed(2)}`} readOnly disabled className="font-semibold"/>
              </FormItem>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (
                  <FormItem><FormLabel>Low Stock Threshold *</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                 <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (
                  <FormItem><FormLabel>Unit of Measure (e.g., pcs, kg)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="weight" render={({ field }) => (
                <FormItem><FormLabel>Weight (e.g., in kg) *</FormLabel><FormControl><Input type="number" step="0.001" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormLabel>Dimensions *</FormLabel>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-md items-end">
                <FormField control={form.control} name="dimensions_length" render={({ field }) => (
                  <FormItem><FormLabel>Length</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="dimensions_width" render={({ field }) => (
                  <FormItem><FormLabel>Width</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="dimensions_height" render={({ field }) => (
                  <FormItem><FormLabel>Height</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="dimensions_unit" render={({ field }) => (
                  <FormItem><FormLabel>Unit</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {dimensionUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              
              <FormItem>
                <FormLabel>Product Image *</FormLabel>
                {(imagePreview || currentImageUrl) && (
                  <div className="mt-2 relative w-48 h-48 border rounded-md overflow-hidden" data-ai-hint="product photo">
                    <Image 
                        src={imagePreview || currentImageUrl || "https://placehold.co/400x400.png?text=No+Image"}
                        alt={product?.name || "Product Image"} 
                        layout="fill" 
                        objectFit="cover" 
                        onError={(e) => { 
                           const target = e.target as HTMLImageElement;
                           if (target.src === currentImageUrl) {
                               setCurrentImageUrl("https://placehold.co/400x400.png?text=Error+Loading");
                           } else if (target.src === imagePreview) {
                               setImagePreview("https://placehold.co/400x400.png?text=Preview+Error");
                           } else {
                               target.src = "https://placehold.co/400x400.png?text=Image+Error";
                           }
                        }}
                    />
                  </div>
                )}
                <FormControl>
                  <Input type="file" accept="image/png, image/jpeg, image/gif" onChange={handleImageChange} className="mt-2 file:text-primary file:font-semibold hover:file:bg-primary/10"/>
                </FormControl>
                {isUploading && uploadProgress !== null && (
                  <div className="mt-2">
                    <Progress value={uploadProgress} className="w-full" />
                    <p className="text-sm text-muted-foreground text-center mt-1">Uploading: {uploadProgress.toFixed(0)}%</p>
                  </div>
                )}
                 <FormField
                    control={form.control}
                    name="imageUrl"
                    render={() => <FormMessage />} 
                  />
                <p className="text-xs text-muted-foreground mt-1">Upload a new PNG, JPG, or GIF image to replace the current one.</p>
              </FormItem>

              <FormField control={form.control} name="tags" render={({ field }) => (
                <FormItem><FormLabel>Tags (comma-separated) *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="promotionStartDate" render={({ field }) => (
                  <FormItem><FormLabel>Promotion Start Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="promotionEndDate" render={({ field }) => (
                  <FormItem><FormLabel>Promotion End Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
               <FormField control={form.control} name="isAvailableForSale" render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <FormLabel className="font-normal">Available for Sale</FormLabel>
                </FormItem>
              )} />

            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || isLoadingDeps || isUploading}>
                {isSubmitting || isUploading ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Edit />}
                 {isUploading ? "Uploading..." : (isSubmitting ? "Saving..." : "Save Changes")}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </>
  );
}
