
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { Timestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL, type StorageError } from "firebase/storage";
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
import { createProduct, calculateSellingPrice, type CreateProductData } from "@/services/productService";
import { getAllCategories } from "@/services/categoryService";
import { getAllSuppliers } from "@/services/supplierService";
import { createSupplierProduct, type CreateSupplierProductData as CreateSPData } from "@/services/supplierProductService";
import type { Category, Supplier, PriceRange } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { storage } from "@/lib/firebase";
import { Progress } from "@/components/ui/progress";

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
        const originalIndex = ranges.indexOf(current); // Get original index for error path

        // Rule 1: maxQuantity (if not null) must be greater than minQuantity
        if (current.maxQuantity !== null && current.maxQuantity !== undefined) {
          if (current.maxQuantity <= current.minQuantity) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Max quantity (${current.maxQuantity}) must be greater than its min quantity (${current.minQuantity}).`,
              path: [originalIndex, "maxQuantity"],
            });
          }
        }

        // Rule 2: Check for overlaps with the *next* range
        if (i < sortedRanges.length - 1) {
          const next = sortedRanges[i + 1];
          const originalNextIndex = ranges.indexOf(next);

          // If current range has defined max quantity
          if (current.maxQuantity !== null && current.maxQuantity !== undefined) {
            if (next.minQuantity <= current.maxQuantity) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Range overlap: Min quantity (${next.minQuantity}) of this range cannot be less than or equal to max quantity (${current.maxQuantity}) of the previous range.`,
                path: [originalNextIndex, "minQuantity"], 
              });
            }
          } else {
            // Current range has maxQuantity = null (i.e., "or more")
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
  sku: z.string().optional(), 
  basePrice: z.coerce.number().min(0, "Base price must be non-negative."),
  discountPercentage: z.coerce.number().min(0).max(100).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  unitOfMeasure: z.string().optional(),
  categoryIds: z.array(z.string()).min(1, "At least one category is required."),
  isAvailableForSale: z.boolean().default(true),
  promotionStartDate: z.string().nullable().optional(),
  promotionEndDate: z.string().nullable().optional(),
  imageUrl: z.string().url("Must be a valid URL if provided").optional().or(z.literal('')), 
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

const generateSupplierSku = (supplierName: string, productNameOrSku: string): string => {
  const supPrefix = supplierName.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prodPrefix = productNameOrSku.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase(); 
  return `${supPrefix || 'SUP'}-${prodPrefix || 'PROD'}-${randomSuffix}`;
};

export default function CreateProductPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoadingDeps, setIsLoadingDeps] = useState(true);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [isSupplierProductDialogOpen, setIsSupplierProductDialogOpen] = useState(false);
  const [editingSupplierProductIndex, setEditingSupplierProductIndex] = useState<number | null>(null);
  
  const supplierProductDialogForm = useForm<SupplierProductFormData>({
    resolver: zodResolver(supplierProductFormSchema),
    defaultValues: {
      supplierId: "", supplierSku: "", isAvailable: true, notes: "", isActive: true,
      priceRanges: [{ minQuantity: 0, maxQuantity: null, price: null, priceType: "fixed", additionalConditions: "" }]
    }
  });
  const { fields: priceRangeFields, append: appendPriceRange, remove: removePriceRange } = useFieldArray({
    control: supplierProductDialogForm.control, name: "priceRanges",
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "", description: "", basePrice: 0, discountPercentage: 0, discountAmount: 0,
      unitOfMeasure: "", categoryIds: [], isAvailableForSale: true, promotionStartDate: null,
      promotionEndDate: null, imageUrl: "", tags: "", lowStockThreshold: 10, supplierId: "",
      barcode: "", weight: 0, dimensions_length: 0, dimensions_width: 0, dimensions_height: 0,
      dimensions_unit: "cm", supplierSpecificInfo: [],
    },
  });
  
  const { fields: supplierSpecificInfoFields, append: appendSupplierSpecificInfo, remove: removeSupplierSpecificInfoFromForm, update: updateSupplierSpecificInfo } = useFieldArray({ 
    control: form.control, name: "supplierSpecificInfo"
  });

  const { watch, setValue, setError, clearErrors, getValues } = form;
  const watchedBasePrice = watch("basePrice");
  const watchedDiscountPercentage = watch("discountPercentage");
  const watchedDiscountAmount = watch("discountAmount");
  const mainProductNameForSku = form.watch("name"); 

  const calculatedSellingPrice = useMemo(() => {
    return calculateSellingPrice(
      watchedBasePrice || 0, watchedDiscountPercentage || 0, watchedDiscountAmount || 0
    );
  }, [watchedBasePrice, watchedDiscountPercentage, watchedDiscountAmount]);

  useEffect(() => {
    async function fetchDependencies() {
      setIsLoadingDeps(true);
      try {
        const [fetchedCategories, fetchedSuppliers] = await Promise.all([
          getAllCategories({ filterActive: true, orderBySortOrder: true }),
          getAllSuppliers({ filterActive: true }),
        ]);
        setCategories(fetchedCategories);
        setSuppliers(fetchedSuppliers);
      } catch (error) {
        console.error("Failed to fetch categories or suppliers:", error);
        toast({ title: "Error", description: "Could not load required data (categories/suppliers).", variant: "destructive" });
      }
      setIsLoadingDeps(false);
    }
    fetchDependencies();
  }, [toast]);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => { setImagePreview(reader.result as string); };
      reader.readAsDataURL(file);
      clearErrors("imageUrl"); 
      setValue("imageUrl", ""); 
    } else {
      setImageFile(null); setImagePreview(null);
    }
  };

  const handleOpenSupplierProductDialog = (index: number | null = null) => {
    if (index !== null && supplierSpecificInfoFields[index]) {
      setEditingSupplierProductIndex(index);
      const currentData = getValues(`supplierSpecificInfo.${index}`);
      supplierProductDialogForm.reset({ 
        ...currentData,
        supplierSku: currentData.supplierSku || "" 
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
  
  const watchedSupplierIdInDialog = supplierProductDialogForm.watch('supplierId');
  useEffect(() => {
    if (editingSupplierProductIndex === null && watchedSupplierIdInDialog) { 
      const selectedSupplier = suppliers.find(s => s.id === watchedSupplierIdInDialog);
      if (selectedSupplier && mainProductNameForSku) {
        const newSku = generateSupplierSku(selectedSupplier.name, mainProductNameForSku);
        supplierProductDialogForm.setValue('supplierSku', newSku, { shouldValidate: true });
      } else if (selectedSupplier && !mainProductNameForSku) {
         supplierProductDialogForm.setValue('supplierSku', generateSupplierSku(selectedSupplier.name, "PRODUCT"), { shouldValidate: true });
      }
    }
  }, [watchedSupplierIdInDialog, editingSupplierProductIndex, suppliers, mainProductNameForSku, supplierProductDialogForm]);


  async function onSubmit(values: ProductFormData) {
    if (!currentUser?.uid) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    let uploadedImageUrl = values.imageUrl || ""; 

    if (imageFile) {
      setIsUploading(true); setUploadProgress(0);
      const storageRef = ref(storage, `products_images/${Date.now()}_${imageFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, imageFile);
      try {
        await new Promise<void>((resolve, reject) => {
          uploadTask.on("state_changed", (snapshot) => setUploadProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
            (error: StorageError) => {
              console.error("Image upload error:", error);
              toast({ title: "Image Upload Failed", description: error.message, variant: "destructive" });
              setIsUploading(false); setUploadProgress(null); reject(error); 
            },
            async () => {
              uploadedImageUrl = await getDownloadURL(uploadTask.snapshot.ref);
              setValue("imageUrl", uploadedImageUrl); 
              setIsUploading(false); setUploadProgress(null); resolve(); 
            });
        });
      } catch (error) { setIsSubmitting(false); return; }
    }
    
    if (!uploadedImageUrl || uploadedImageUrl.trim() === "") {
        form.setError("imageUrl", { type: "manual", message: "Product image is required. Please upload an image." });
        setIsSubmitting(false); setIsUploading(false); return; 
    }

    try {
      const finalFormValues = getValues(); 
      const productData: CreateProductData = {
        name: finalFormValues.name, description: finalFormValues.description, sku: finalFormValues.sku || undefined,
        basePrice: finalFormValues.basePrice, discountPercentage: finalFormValues.discountPercentage,
        discountAmount: finalFormValues.discountAmount, unitOfMeasure: finalFormValues.unitOfMeasure,
        categoryIds: finalFormValues.categoryIds, isAvailableForSale: finalFormValues.isAvailableForSale,
        imageUrl: uploadedImageUrl, tags: finalFormValues.tags.split(",").map(tag => tag.trim()).filter(tag => tag.length > 0),
        lowStockThreshold: finalFormValues.lowStockThreshold, supplierId: finalFormValues.supplierId,
        barcode: finalFormValues.barcode, weight: finalFormValues.weight,
        dimensions: {
          length: finalFormValues.dimensions_length, width: finalFormValues.dimensions_width,
          height: finalFormValues.dimensions_height, dimensionUnit: finalFormValues.dimensions_unit,
        },
        costPrice: 0, 
        promotionStartDate: finalFormValues.promotionStartDate ? Timestamp.fromDate(new Date(finalFormValues.promotionStartDate)) : null,
        promotionEndDate: finalFormValues.promotionEndDate ? Timestamp.fromDate(new Date(finalFormValues.promotionEndDate)) : null,
      };
      const newProductId = await createProduct(productData, currentUser.uid);

      if (finalFormValues.supplierSpecificInfo) {
        for (const item of finalFormValues.supplierSpecificInfo) {
          if (item.isActive !== false) { 
            const spData: CreateSPData = {
              supplierId: item.supplierId, productId: newProductId, supplierSku: item.supplierSku,
              priceRanges: item.priceRanges.map(pr => ({...pr, price: pr.price === null ? null : Number(pr.price), maxQuantity: pr.maxQuantity === null ? null : Number(pr.maxQuantity) })),
              isAvailable: item.isAvailable, notes: item.notes || "",
            };
            await createSupplierProduct(spData, currentUser.uid);
          }
        }
      }

      toast({ title: "Product Created!", description: `${finalFormValues.name} has been successfully added.` });
      router.push("/products");
    } catch (error: any) {
      console.error("Failed to create product:", error);
      toast({ title: "Creation Failed", description: error.message || "Could not create the product.", variant: "destructive" });
    } finally {
      setIsSubmitting(false); setIsUploading(false); 
    }
  }

  return (
    <>
      <PageHeader title="Add New Product" description="Fill in the details for the new product." />
      <Card className="w-full max-w-3xl mx-auto shadow-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle className="font-headline">Product Information</CardTitle>
              <CardDescription>Fields marked with * are required. SKU is auto-generated. Selling price is calculated. Cost price is $0.00 (updated via receipts).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Product Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="barcode" render={({ field }) => (<FormItem><FormLabel>Barcode *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="categoryIds" render={() => (
                <FormItem>
                  <FormLabel>Categories *</FormLabel>
                  {isLoadingDeps ? <p>Loading categories...</p> : categories.length === 0 ? <p>No active categories. Create one first.</p> :
                  <ScrollArea className="h-40 rounded-md border p-2">
                    {categories.map((category) => (
                      <FormField key={category.id} control={form.control} name="categoryIds" render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0 py-1">
                            <FormControl><Checkbox checked={field.value?.includes(category.id)} onCheckedChange={(checked) => { return checked ? field.onChange([...(field.value || []), category.id]) : field.onChange((field.value || []).filter(id => id !== category.id)); }} /></FormControl>
                            <FormLabel className="font-normal">{category.name}</FormLabel>
                          </FormItem> )} /> ))}
                  </ScrollArea>} <FormMessage />
                </FormItem> )} />
              <FormField control={form.control} name="supplierId" render={({ field }) => (
                <FormItem><FormLabel>Primary Supplier *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isLoadingDeps}>
                    <FormControl><SelectTrigger><SelectValue placeholder={isLoadingDeps ? "Loading..." : "Select supplier"} /></SelectTrigger></FormControl>
                    <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select><FormMessage />
                </FormItem> )} />
              <FormItem><FormLabel>Initial Cost Price</FormLabel><FormControl><Input type="text" value="$0.00" readOnly disabled className="text-muted-foreground" /></FormControl><p className="text-xs text-muted-foreground">Updated via stock receipts.</p></FormItem>
              <FormField control={form.control} name="basePrice" render={({ field }) => (<FormItem><FormLabel>Base Price *</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="discountPercentage" render={({ field }) => (<FormItem><FormLabel>Discount % (0-100)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="discountAmount" render={({ field }) => (<FormItem><FormLabel>Discount Amount</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormItem><FormLabel>Calculated Selling Price</FormLabel><Input type="text" value={`$${calculatedSellingPrice.toFixed(2)}`} readOnly disabled className="font-semibold" /></FormItem>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="lowStockThreshold" render={({ field }) => (<FormItem><FormLabel>Low Stock Threshold *</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                 <FormField control={form.control} name="unitOfMeasure" render={({ field }) => (<FormItem><FormLabel>Unit of Measure (e.g., pcs, kg)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="weight" render={({ field }) => (<FormItem><FormLabel>Weight (e.g., in kg) *</FormLabel><FormControl><Input type="number" step="0.001" {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormLabel>Dimensions *</FormLabel>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 border rounded-md items-end">
                <FormField control={form.control} name="dimensions_length" render={({ field }) => (<FormItem><FormLabel>Length</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_width" render={({ field }) => (<FormItem><FormLabel>Width</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_height" render={({ field }) => (<FormItem><FormLabel>Height</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="dimensions_unit" render={({ field }) => (<FormItem><FormLabel>Unit</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger></FormControl><SelectContent>{dimensionUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
              </div>
              <FormItem>
                <FormLabel>Product Image *</FormLabel>
                <FormControl><Input type="file" accept="image/png, image/jpeg, image/gif" onChange={handleImageChange} className="file:text-primary file:font-semibold hover:file:bg-primary/10"/></FormControl>
                {imagePreview && (<div className="mt-2 relative w-48 h-48 border rounded-md overflow-hidden" data-ai-hint="product photo"><Image src={imagePreview} alt="Image Preview" layout="fill" objectFit="cover" /></div>)}
                {isUploading && uploadProgress !== null && (<div className="mt-2"><Progress value={uploadProgress} className="w-full" /><p className="text-sm text-muted-foreground text-center mt-1">Uploading: {uploadProgress.toFixed(0)}%</p></div>)}
                <FormField control={form.control} name="imageUrl" render={() => <FormMessage />} />
                <p className="text-xs text-muted-foreground mt-1">Upload a PNG, JPG, or GIF image.</p>
              </FormItem>
              <FormField control={form.control} name="tags" render={({ field }) => (<FormItem><FormLabel>Tags (comma-separated) *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="promotionStartDate" render={({ field }) => (<FormItem><FormLabel>Promotion Start Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="promotionEndDate" render={({ field }) => (<FormItem><FormLabel>Promotion End Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>)} />
              </div>
              <FormField control={form.control} name="isAvailableForSale" render={({ field }) => (<FormItem className="flex flex-row items-center space-x-3 space-y-0"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="font-normal">Available for Sale</FormLabel></FormItem>)} />
            
              <Accordion type="single" collapsible className="w-full" defaultValue="supplier-info">
                <AccordionItem value="supplier-info">
                  <AccordionTrigger className="text-lg font-semibold">Supplier Pricing & Availability (Optional)</AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    {supplierSpecificInfoFields.filter(field => field.isActive !== false).map((field, index) => ( 
                      <Card key={field.id} className="p-4">
                        <CardHeader className="p-0 pb-2 flex flex-row justify-between items-center">
                           <CardTitle className="text-md">
                            {suppliers.find(s => s.id === field.supplierId)?.name || `Supplier SKU: ${field.supplierSku}`}
                           </CardTitle>
                           <div className="space-x-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenSupplierProductDialog(index)}>
                              <Icons.Edit className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button type="button" variant="destructive" size="sm" onClick={() => removeSupplierSpecificInfoFromForm(index)}>
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
                {isSubmitting || isUploading ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Add />}
                {isUploading ? "Uploading..." : (isSubmitting ? "Creating..." : "Create Product")}
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
