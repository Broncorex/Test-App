
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray, Controller } from "react-hook-form";
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth-store.tsx";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import { getProductById, updateProduct, calculateSellingPrice, type UpdateProductData } from "@/services/productService";
import { getAllCategories } from "@/services/categoryService";
import { getAllSuppliers } from "@/services/supplierService";
import { 
  getAllSupplierProductsByProduct, 
  createSupplierProduct, 
  updateSupplierProduct,
  toggleSupplierProductActiveStatus,
  type CreateSupplierProductData,
  type UpdateSupplierProductData as UpdateSPData
} from "@/services/supplierProductService";
import type { Product, Category, Supplier, ProveedorProducto, PriceRange } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { storage } from "@/lib/firebase";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

const dimensionUnits = ["cm", "m", "in", "mm", "ft"];

const priceRangeSchema = z.object({
  id: z.string().optional(),
  minQuantity: z.coerce.number().min(0, "Min quantity must be non-negative."),
  maxQuantity: z.coerce.number().nullable().optional(),
  price: z.coerce.number().min(0, "Price must be non-negative.").nullable().optional(),
  priceType: z.enum(["fixed", "negotiable"], { required_error: "Price type is required."}),
  additionalConditions: z.string().optional(),
});

const supplierProductFormSchema = z.object({
  id: z.string().optional(), 
  supplierId: z.string().min(1, "Supplier is required."),
  supplierName: z.string().optional(), 
  supplierSku: z.string().min(1, "Supplier SKU is required."),
  isAvailable: z.boolean().default(true),
  notes: z.string().optional(),
  priceRanges: z.array(priceRangeSchema)
    .min(1, "At least one price range is required.")
    .superRefine((ranges, ctx) => {
      if (ranges.length <= 1) return;

      const sortedRanges = [...ranges].sort((a, b) => a.minQuantity - b.minQuantity);

      for (let i = 0; i < sortedRanges.length; i++) {
        const current = sortedRanges[i];
        const originalIndex = ranges.indexOf(current);

        if (current.maxQuantity !== null && current.maxQuantity !== undefined) {
          if (current.maxQuantity <= current.minQuantity) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Max quantity (${current.maxQuantity}) must be greater than its min quantity (${current.minQuantity}).`,
              path: [originalIndex, "maxQuantity"],
            });
          }
        }

        if (i < sortedRanges.length - 1) {
          const next = sortedRanges[i + 1];
          const originalNextIndex = ranges.indexOf(next);

          if (current.maxQuantity !== null && current.maxQuantity !== undefined) {
            if (next.minQuantity <= current.maxQuantity) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Range overlap: Min quantity (${next.minQuantity}) of this range cannot be less than or equal to max quantity (${current.maxQuantity}) of the previous range.`,
                path: [originalNextIndex, "minQuantity"],
              });
            }
          } else {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "A price range with no maximum quantity (i.e., 'or more') must be the last range defined.",
              path: [originalIndex, "maxQuantity"],
            });
          }
        }
      }
    }),
  isActive: z.boolean().default(true), 
});

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
  supplierSpecificInfo: z.array(supplierProductFormSchema).optional(),
});

type ProductFormData = z.infer<typeof productFormSchema>;
type SupplierProductFormData = z.infer<typeof supplierProductFormSchema>;
type PriceRangeFormData = z.infer<typeof priceRangeSchema>;

const formatDateForInput = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp) return "";
  return timestamp.toDate().toISOString().split('T')[0];
};

const getDimensionValue = (nestedVal: number | undefined, flatValStr: string | undefined): number => {
    if (typeof nestedVal === 'number' && !isNaN(nestedVal)) return nestedVal;
    if (typeof flatValStr === 'string') {
        const num = parseFloat(flatValStr);
        if (!isNaN(num)) return num;
    }
    if (typeof flatValStr === 'number' && !isNaN(flatValStr)) return flatValStr;
    return 0; 
};

const generateSupplierSku = (supplierName: string, productNameOrSku: string): string => {
  const supPrefix = supplierName.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prodPrefix = productNameOrSku.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase(); 
  return `${supPrefix || 'SUP'}-${prodPrefix || 'PROD'}-${randomSuffix}`;
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
  const [fetchedSupplierProducts, setFetchedSupplierProducts] = useState<ProveedorProducto[]>([]);
  const [isLoadingDeps, setIsLoadingDeps] = useState(true);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [isSupplierProductDialogOpen, setIsSupplierProductDialogOpen] = useState(false);
  const [editingSupplierProductIndex, setEditingSupplierProductIndex] = useState<number | null>(null);
  
  const supplierProductDialogForm = useForm<SupplierProductFormData>({
    resolver: zodResolver(supplierProductFormSchema),
    defaultValues: {
      supplierId: "",
      supplierSku: "",
      isAvailable: true,
      notes: "",
      priceRanges: [{ minQuantity: 0, maxQuantity: null, price: null, priceType: "fixed", additionalConditions: "" }],
      isActive: true,
    }
  });
  const { fields: priceRangeFields, append: appendPriceRange, remove: removePriceRange } = useFieldArray({
    control: supplierProductDialogForm.control,
    name: "priceRanges",
  });


  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      supplierSpecificInfo: [],
    }
  });

  const { fields: supplierSpecificInfoFields, append: appendSupplierSpecificInfo, remove: removeSupplierSpecificInfo, update: updateSupplierSpecificInfo } = useFieldArray({
    control: form.control,
    name: "supplierSpecificInfo"
  });


  const { watch, reset, setValue, setError, clearErrors, getValues } = form;
  const watchedBasePrice = watch("basePrice");
  const watchedDiscountPercentage = watch("discountPercentage");
  const watchedDiscountAmount = watch("discountAmount");

  const calculatedSellingPrice = useMemo(() => {
    return calculateSellingPrice(
      Number(watchedBasePrice || 0),
      Number(watchedDiscountPercentage || 0),
      Number(watchedDiscountAmount || 0)
    );
  }, [watchedBasePrice, watchedDiscountPercentage, watchedDiscountAmount]);

  const fetchProductAndDepsData = useCallback(async () => {
    if (!productId) return;
    setIsLoadingData(true);
    setIsLoadingDeps(true);
    try {
      const [fetchedProd, fetchedCats, fetchedSupps, fetchedSupProds] = await Promise.all([
        getProductById(productId),
        getAllCategories({ filterActive: true, orderBySortOrder: true }),
        getAllSuppliers({ filterActive: true }),
        getAllSupplierProductsByProduct(productId, true), 
      ]);

      setCategories(fetchedCats);
      setSuppliers(fetchedSupps);
      setFetchedSupplierProducts(fetchedSupProds); 
      setIsLoadingDeps(false);

      if (fetchedProd) {
        setProduct(fetchedProd);
        setCurrentImageUrl(fetchedProd.imageUrl);
        const flatProductData = fetchedProd as any;

        const supplierSpecificInfoData: SupplierProductFormData[] = fetchedSupProds.map(sp => ({
          id: sp.id,
          supplierId: sp.supplierId,
          supplierName: fetchedSupps.find(s => s.id === sp.supplierId)?.name || 'Unknown Supplier',
          supplierSku: sp.supplierSku,
          isAvailable: sp.isAvailable,
          notes: sp.notes,
          priceRanges: sp.priceRanges.map(pr => ({ ...pr })),
          isActive: sp.isActive,
        }));

        reset({
          name: fetchedProd.name,
          description: fetchedProd.description,
          basePrice: Number(fetchedProd.basePrice),
          discountPercentage: Number(fetchedProd.discountPercentage || 0),
          discountAmount: Number(fetchedProd.discountAmount || 0),
          unitOfMeasure: fetchedProd.unitOfMeasure || "",
          categoryIds: fetchedProd.categoryIds || [],
          isAvailableForSale: fetchedProd.isAvailableForSale,
          promotionStartDate: formatDateForInput(fetchedProd.promotionStartDate),
          promotionEndDate: formatDateForInput(fetchedProd.promotionEndDate),
          imageUrl: fetchedProd.imageUrl,
          tags: (fetchedProd.tags || []).join(", "),
          lowStockThreshold: Number(fetchedProd.lowStockThreshold),
          supplierId: fetchedProd.supplierId,
          barcode: fetchedProd.barcode,
          weight: Number(fetchedProd.weight),
          dimensions_length: Number(getDimensionValue(fetchedProd.dimensions?.length, flatProductData.dimensions_length)),
          dimensions_width: Number(getDimensionValue(fetchedProd.dimensions?.width, flatProductData.dimensions_width)),
          dimensions_height: Number(getDimensionValue(fetchedProd.dimensions?.height, flatProductData.dimensions_height)),
          dimensions_unit: fetchedProd.dimensions?.dimensionUnit || flatProductData.dimensions_unit || "cm",
          supplierSpecificInfo: supplierSpecificInfoData,
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
      reader.onloadend = () => {setImagePreview(reader.result as string);};
      reader.readAsDataURL(file);
      clearErrors("imageUrl");
      setValue("imageUrl", ""); 
    } else {
      setImageFile(null);
      setImagePreview(null);
      if (product) setValue("imageUrl", product.imageUrl);
    }
  };
  
  const handleOpenSupplierProductDialog = (index: number | null = null) => {
    if (index !== null && supplierSpecificInfoFields[index]) {
      setEditingSupplierProductIndex(index);
      const currentData = getValues(`supplierSpecificInfo.${index}`);
      supplierProductDialogForm.reset({
        ...currentData,
        supplierSku: currentData.supplierSku || "", 
        priceRanges: currentData.priceRanges && currentData.priceRanges.length > 0 
          ? currentData.priceRanges.map(pr => ({...pr})) 
          : [{ minQuantity: 0, maxQuantity: null, price: null, priceType: "fixed", additionalConditions: "" }]
      });
    } else {
      setEditingSupplierProductIndex(null);
      supplierProductDialogForm.reset({
        supplierId: "", supplierSku: "", isAvailable: true, notes: "", isActive: true,
        priceRanges: [{ minQuantity: 0, maxQuantity: null, price: null, priceType: "fixed", additionalConditions: "" }]
      });
    }
    setIsSupplierProductDialogOpen(true);
  };

  const handleSaveSupplierProduct = (data: SupplierProductFormData) => {
    const supplierName = suppliers.find(s => s.id === data.supplierId)?.name;
    const dataWithSupplierName = { ...data, supplierName };

    if (editingSupplierProductIndex !== null) {
      updateSupplierSpecificInfo(editingSupplierProductIndex, dataWithSupplierName);
    } else {
      appendSupplierSpecificInfo(dataWithSupplierName);
    }
    setIsSupplierProductDialogOpen(false);
    setEditingSupplierProductIndex(null);
  };
  
  const handleRemoveSupplierSpecificInfo = (index: number) => {
    const item = getValues(`supplierSpecificInfo.${index}`);
    if (item.id) { 
      updateSupplierSpecificInfo(index, { ...item, isActive: false });
    } else { 
      removeSupplierSpecificInfo(index);
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
          uploadTask.on("state_changed", (snapshot) => setUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
            (error: StorageError) => {
              console.error("New image upload error:", error);
              toast({ title: "Image Upload Failed", description: error.message, variant: "destructive" });
              setIsUploading(false); setUploadProgress(null); reject(error);
            },
            async () => {
              finalImageUrl = await getDownloadURL(uploadTask.snapshot.ref);
              setValue("imageUrl", finalImageUrl);
              if (currentImageUrl && currentImageUrl !== finalImageUrl && !currentImageUrl.startsWith("https://placehold.co")) {
                try { await deleteObject(ref(storage, currentImageUrl)); } 
                catch (deleteError: any) { console.warn("Failed to delete old product image:", deleteError.message); }
              }
              setCurrentImageUrl(finalImageUrl);
              setIsUploading(false); setUploadProgress(null); setImageFile(null); setImagePreview(null); resolve();
            });
        });
      } catch (error) { setIsSubmitting(false); return; }
    }

    if (!finalImageUrl || finalImageUrl.trim() === "") {
        setError("imageUrl", { type: "manual", message: "Product image is required." });
        setIsSubmitting(false); setIsUploading(false); return;
    }

    try {
      const productData: UpdateProductData = {
        name: values.name, 
        description: values.description, 
        basePrice: Number(values.basePrice),
        discountPercentage: Number(values.discountPercentage || 0), 
        discountAmount: Number(values.discountAmount || 0),
        unitOfMeasure: values.unitOfMeasure, 
        categoryIds: values.categoryIds,
        isAvailableForSale: values.isAvailableForSale,
        promotionStartDate: values.promotionStartDate ? Timestamp.fromDate(new Date(values.promotionStartDate)) : null,
        promotionEndDate: values.promotionEndDate ? Timestamp.fromDate(new Date(values.promotionEndDate)) : null,
        imageUrl: finalImageUrl, 
        tags: values.tags.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0),
        lowStockThreshold: Number(values.lowStockThreshold), 
        supplierId: values.supplierId, 
        barcode: values.barcode,
        weight: Number(values.weight), 
        dimensions: {
          length: Number(values.dimensions_length), 
          width: Number(values.dimensions_width),
          height: Number(values.dimensions_height), 
          dimensionUnit: values.dimensions_unit,
        }
      };
      await updateProduct(productId, productData);

      if (values.supplierSpecificInfo) {
        for (const item of values.supplierSpecificInfo) {
          const serviceData = {
            supplierId: item.supplierId,
            productId: productId, 
            supplierSku: item.supplierSku,
            priceRanges: item.priceRanges.map(pr => ({
                ...pr, 
                price: pr.price === null ? null : Number(pr.price), 
                minQuantity: Number(pr.minQuantity),
                maxQuantity: pr.maxQuantity === null ? null : Number(pr.maxQuantity)
            })),
            isAvailable: item.isAvailable,
            notes: item.notes || "",
          };

          if (item.id) { 
            if (item.isActive === false) { 
               const existing = fetchedSupplierProducts.find(fsp => fsp.id === item.id);
               if(existing && existing.isActive) { 
                await toggleSupplierProductActiveStatus(item.id, true); 
               }
            } else { 
              await updateSupplierProduct(item.id, serviceData as UpdateSPData);
            }
          } else if (item.isActive !== false) { 
            await createSupplierProduct(serviceData as CreateSupplierProductData, currentUser.uid);
          }
        }
      }
      
      for (const fetchedItem of fetchedSupplierProducts) {
        const stillExistsInForm = values.supplierSpecificInfo?.find(formItem => formItem.id === fetchedItem.id && formItem.isActive !== false);
        if (!stillExistsInForm && fetchedItem.isActive) { 
          await toggleSupplierProductActiveStatus(fetchedItem.id, true); 
        }
      }


      toast({ title: "Product Updated!", description: `${values.name} has been successfully updated.` });
      router.push("/products");
    } catch (error: any) {
      console.error("Failed to update product:", error);
      toast({ title: "Update Failed", description: error.message || "Could not update the product.", variant: "destructive" });
    } finally {
      setIsSubmitting(false); setIsUploading(false);
    }
  }

  const mainProductName = product?.name || "";
  const mainProductSku = product?.sku || "";
  const watchedSupplierIdInDialog = supplierProductDialogForm.watch('supplierId');

  useEffect(() => {
    if (editingSupplierProductIndex === null && watchedSupplierIdInDialog) { 
      const selectedSupplier = suppliers.find(s => s.id === watchedSupplierIdInDialog);
      if (selectedSupplier) {
        const newSku = generateSupplierSku(selectedSupplier.name, mainProductName || mainProductSku);
        supplierProductDialogForm.setValue('supplierSku', newSku, { shouldValidate: true });
      }
    }
  }, [watchedSupplierIdInDialog, editingSupplierProductIndex, suppliers, mainProductName, mainProductSku, supplierProductDialogForm]);


  if (isLoadingData || !product) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit Product" description="Loading product details..." />
        <Card className="w-full max-w-3xl mx-auto">
          <CardHeader><Skeleton className="h-8 w-1/2" /></CardHeader>
          <CardContent className="space-y-6">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent>
          <CardFooter><Skeleton className="h-10 w-24 ml-auto" /></CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={`Edit Product: ${product.name}`} description="Update product details. Cost price is updated via receipts." />
      <Card className="w-full max-w-3xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Product Information (SKU: {product.sku})</CardTitle>
              <CardDescription>Fields marked with * are required. Selling price is calculated. Cost price is read-only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Product Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormItem><FormLabel>SKU (Read-only)</FormLabel><FormControl><Input value={product.sku} readOnly disabled /></FormControl></FormItem>
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="barcode" render={({ field }) => (<FormItem><FormLabel>Barcode *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />

               <FormField control={form.control} name="categoryIds" render={() => (
                <FormItem>
                  <FormLabel>Categories *</FormLabel>
                  {isLoadingDeps ? <p>Loading categories...</p> : categories.length === 0 ? <p>No active categories.</p> : (
                  <ScrollArea className="h-40 rounded-md border p-2">
                    {categories.map((category) => (
                      <FormField key={category.id} control={form.control} name="categoryIds"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0 py-1">
                            <FormControl><Checkbox checked={field.value?.includes(category.id)} onCheckedChange={(checked) => { const current = field.value || []; return checked ? field.onChange([...current, category.id]) : field.onChange(current.filter(id => id !== category.id)); }} /></FormControl>
                            <FormLabel className="font-normal">{category.name}</FormLabel>
                          </FormItem>
                        )} /> ))}
                  </ScrollArea> )} <FormMessage />
                </FormItem> )} />
              
              <FormField control={form.control} name="supplierId" render={({ field }) => (<FormItem><FormLabel>Primary Supplier *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingDeps}>
                    <FormControl><SelectTrigger><SelectValue placeholder={isLoadingDeps ? "Loading..." : "Select supplier"} /></SelectTrigger></FormControl>
                    <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem> )} />

              <FormItem><FormLabel>Cost Price (Read-only)</FormLabel><FormControl><Input type="number" value={product.costPrice} readOnly disabled className="text-muted-foreground" /></FormControl><p className="text-xs text-muted-foreground">Updated via stock receipts.</p></FormItem>
              <FormField control={form.control} name="basePrice" render={({ field }) => (<FormItem><FormLabel>Base Price *</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="discountPercentage" render={({ field }) => (<FormItem><FormLabel>Discount %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="discountAmount" render={({ field }) => (<FormItem><FormLabel>Discount Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormItem><FormLabel>Calculated Selling Price</FormLabel><Input type="text" value={`$${calculatedSellingPrice.toFixed(2)}`} readOnly disabled className="font-semibold"/></FormItem>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (<FormItem><FormLabel>Low Stock Threshold *</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (<FormItem><FormLabel>Unit of Measure</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="weight" render={({ field }) => (<FormItem><FormLabel>Weight (kg) *</FormLabel><FormControl><Input type="number" step="0.001" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormLabel>Dimensions *</FormLabel>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-md items-end">
                <FormField control={form.control} name="dimensions_length" render={({ field }) => (<FormItem><FormLabel>Length</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_width" render={({ field }) => (<FormItem><FormLabel>Width</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_height" render={({ field }) => (<FormItem><FormLabel>Height</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_unit" render={({ field }) => (<FormItem><FormLabel>Unit</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger></FormControl><SelectContent>{dimensionUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
              </div>
              <FormItem>
                <FormLabel>Product Image *</FormLabel>
                {(imagePreview || currentImageUrl) && (<div className="mt-2 relative w-48 h-48 border rounded-md overflow-hidden" data-ai-hint="product photo"><Image src={imagePreview || currentImageUrl || "https://placehold.co/400x400.png?text=No+Image"} alt={product?.name || "Product Image"} layout="fill" objectFit="cover" onError={(e) => { const t = e.target as HTMLImageElement; if (t.src === currentImageUrl) setCurrentImageUrl("https://placehold.co/400x400.png?text=Error"); else if (t.src === imagePreview) setImagePreview("https://placehold.co/400x400.png?text=Preview+Error"); else t.src = "https://placehold.co/400x400.png?text=Image+Error";}}/></div>)}
                <FormControl><Input type="file" accept="image/png, image/jpeg, image/gif" onChange={handleImageChange} className="mt-2 file:text-primary file:font-semibold hover:file:bg-primary/10"/></FormControl>
                {isUploading && uploadProgress !== null && (<div className="mt-2"><Progress value={uploadProgress} className="w-full" /><p className="text-sm text-muted-foreground text-center mt-1">Uploading: {uploadProgress.toFixed(0)}%</p></div>)}
                <FormField control={form.control} name="imageUrl" render={() => <FormMessage />} />
                <p className="text-xs text-muted-foreground mt-1">Upload new PNG, JPG, or GIF to replace.</p>
              </FormItem>
              <FormField control={form.control} name="tags" render={({ field }) => (<FormItem><FormLabel>Tags (comma-separated) *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="promotionStartDate" render={({ field }) => (<FormItem><FormLabel>Promo Start</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="promotionEndDate" render={({ field }) => (<FormItem><FormLabel>Promo End</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="isAvailableForSale" render={({ field }) => (<FormItem className="flex flex-row items-center space-x-3 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-normal">Available for Sale</FormLabel></FormItem>)} />
            
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="supplier-info">
                  <AccordionTrigger className="text-lg font-semibold">Supplier Pricing & Availability</AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    {supplierSpecificInfoFields.filter(field => field.isActive !== false).map((field, index) => (
                      <Card key={field.id} className="p-4">
                        <CardHeader className="p-0 pb-2 flex flex-row justify-between items-center">
                           <CardTitle className="text-md">
                            {suppliers.find(s => s.id === field.supplierId)?.name || `Supplier SKU: ${field.supplierSku}` }
                           </CardTitle>
                           <div className="space-x-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenSupplierProductDialog(index)}>
                              <Icons.Edit className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button type="button" variant="destructive" size="sm" onClick={() => handleRemoveSupplierSpecificInfo(index)}>
                              <Icons.Delete className="mr-1 h-3 w-3" /> Remove
                            </Button>
                           </div>
                        </CardHeader>
                        <CardContent className="p-0 text-sm">
                           <p>SKU: {field.supplierSku}</p>
                           <p>Available: {field.isAvailable ? 'Yes' : 'No'}</p>
                           {field.notes && <p>Notes: {field.notes}</p>}
                           <p>Price Ranges: {field.priceRanges?.length || 0}</p>
                        </CardContent>
                      </Card>
                    ))}
                     {supplierSpecificInfoFields.filter(field => field.isActive !== false).length === 0 && (
                        <p className="text-muted-foreground text-sm">No additional supplier pricing linked for this product.</p>
                     )}
                    <Button type="button" variant="outline" onClick={() => handleOpenSupplierProductDialog()} className="mt-2">
                      <Icons.Add className="mr-2 h-4 w-4" /> Add Supplier Pricing
                    </Button>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

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

      <Dialog open={isSupplierProductDialogOpen} onOpenChange={setIsSupplierProductDialogOpen}>
        <DialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
          <Form {...supplierProductDialogForm}>
            <form onSubmit={supplierProductDialogForm.handleSubmit(handleSaveSupplierProduct)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <DialogTitle>{editingSupplierProductIndex !== null ? "Edit" : "Add"} Supplier Product Details</DialogTitle>
                <DialogDescription>Manage supplier-specific SKU, pricing, and availability for this product.</DialogDescription>
              </DialogHeader>
              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <FormField control={supplierProductDialogForm.control} name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={isLoadingDeps}>
                        <FormControl><SelectTrigger><SelectValue placeholder={isLoadingDeps ? "Loading suppliers..." : "Select supplier"} /></SelectTrigger></FormControl>
                        <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                <FormField control={supplierProductDialogForm.control} name="supplierSku"
                  render={({ field }) => (<FormItem><FormLabel>Supplier SKU (Auto-generated) *</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={supplierProductDialogForm.control} name="isAvailable"
                  render={({ field }) => (<FormItem className="flex flex-row items-center space-x-3 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-normal">Is Available from this Supplier</FormLabel></FormItem>)} />
                
                <Card>
                  <CardHeader className="p-2"><CardTitle className="text-md">Price Ranges</CardTitle></CardHeader>
                  <CardContent className="p-2 space-y-3">
                    {priceRangeFields.map((item, index) => (
                      <div key={item.id} className="p-3 border rounded-md space-y-2 relative">
                        {priceRangeFields.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => removePriceRange(index)}>
                              <Icons.Delete className="h-4 w-4 text-destructive"/>
                          </Button>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <FormField control={supplierProductDialogForm.control} name={`priceRanges.${index}.minQuantity`}
                            render={({ field }) => (<FormItem><FormLabel>Min Qty*</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={supplierProductDialogForm.control} name={`priceRanges.${index}.maxQuantity`}
                            render={({ field }) => (<FormItem><FormLabel>Max Qty</FormLabel><FormControl><Input type="number" placeholder="None for 'or more'" {...field} value={field.value === null ? '' : field.value} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <FormField control={supplierProductDialogForm.control} name={`priceRanges.${index}.priceType`}
                              render={({ field }) => (<FormItem><FormLabel>Price Type*</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                                  <SelectContent><SelectItem value="fixed">Fixed</SelectItem><SelectItem value="negotiable">Negotiable</SelectItem></SelectContent>
                                  </Select><FormMessage /></FormItem> )}/>
                          <FormField control={supplierProductDialogForm.control} name={`priceRanges.${index}.price`}
                            render={({ field }) => (<FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" step="0.01" placeholder="If fixed" {...field} value={field.value === null ? '' : field.value} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        <FormField control={supplierProductDialogForm.control} name={`priceRanges.${index}.additionalConditions`}
                            render={({ field }) => (<FormItem><FormLabel>Conditions</FormLabel><FormControl><Textarea placeholder="e.g., Valid until DD/MM/YYYY" {...field} /></FormControl><FormMessage /></FormItem>)} />
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => appendPriceRange({ minQuantity: 0, maxQuantity: null, price: null, priceType: "fixed", additionalConditions: "" })}>
                      <Icons.Add className="mr-2 h-4 w-4"/> Add Price Range
                    </Button>
                     {supplierProductDialogForm.formState.errors.priceRanges && typeof supplierProductDialogForm.formState.errors.priceRanges.message === 'string' && (
                        <p className="text-sm font-medium text-destructive">{supplierProductDialogForm.formState.errors.priceRanges.message}</p>
                     )}
                  </CardContent>
                </Card>

                <FormField control={supplierProductDialogForm.control} name="notes"
                  render={({ field }) => (<FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <DialogFooter className="pt-4 flex-shrink-0">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={supplierProductDialogForm.formState.isSubmitting}>
                  {supplierProductDialogForm.formState.isSubmitting ? <Icons.Logo className="animate-spin"/> : "Save Supplier Details"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

