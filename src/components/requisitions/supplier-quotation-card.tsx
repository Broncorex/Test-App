
import React, { useCallback, useMemo } from 'react';
import { Control, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormControl, FormItem, FormLabel as ShadFormLabelFromHookForm, FormMessage as ShadFormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Requisition, Supplier, ProveedorProducto, PriceRange, RequiredProduct as RequisitionRequiredProductType } from "@/types";
import { Button } from '@/components/ui/button';
import type { QuotationRequestFormData } from '@/app/(app)/requisitions/[id]/page';


interface AnalyzedPriceRange {
    currentRange: PriceRange | null;
    currentPricePerUnit: number | null;
    nextBetterRange: PriceRange | null;
    quantityToReachNextBetter: number | null;
    alternativeNextRange: PriceRange | null;
}

interface SupplierQuotationCardProps {
    supplier: Supplier;
    requisitionRequiredProducts: RequisitionRequiredProductType[];
    supplierAnalysisData: Record<string, Record<string, {
        priceAnalysis: AnalyzedPriceRange;
        canQuoteProduct: boolean;
        link: ProveedorProducto | null;
    }>>;
    formInstance: UseFormReturn<QuotationRequestFormData>;
    supplierFormIndex: number;
    isSupplierSelected: boolean;
    onToggleSupplier: (supplier: Supplier, isChecked: boolean) => void;
    isExpanded: boolean;
    onToggleExpand: (supplierId: string) => void;
    isLoadingAllSupplierLinks: boolean;
    getApplicablePriceRange: (quantity: number, priceRangesParam?: PriceRange[]) => PriceRange | null;
    memoizedAnalyzePriceRanges: (originalRequiredQuantity: number, priceRangesParam?: PriceRange[]) => AnalyzedPriceRange;
}

export const SupplierQuotationCard: React.FC<SupplierQuotationCardProps> = ({
    supplier,
    requisitionRequiredProducts,
    supplierAnalysisData,
    formInstance, 
    supplierFormIndex,
    isSupplierSelected,
    onToggleSupplier,
    isExpanded,
    onToggleExpand,
    isLoadingAllSupplierLinks,
    getApplicablePriceRange,
    memoizedAnalyzePriceRanges,
}) => {

    const { fields: productsToQuoteFields, append: appendProduct, remove: removeProduct } = useFieldArray({
        control: formInstance.control,
        name: `suppliersToQuote.${supplierFormIndex}.productsToQuote`,
    });

    const hasAnyQuotableProduct = useMemo(() => {
        return requisitionRequiredProducts.some(
            rp => supplierAnalysisData[supplier.id]?.[rp.productId]?.canQuoteProduct
        );
    }, [requisitionRequiredProducts, supplier.id, supplierAnalysisData]);


    const toggleProductForSupplierInForm = useCallback((
        reqProduct: RequisitionRequiredProductType,
        isChecked: boolean
    ) => {
        const currentProductsToQuote = formInstance.getValues(`suppliersToQuote.${supplierFormIndex}.productsToQuote`) || [];
        const productQuoteIndex = currentProductsToQuote.findIndex(p => p.productId === reqProduct.productId);

        let updatedProductsToQuote = [...currentProductsToQuote];

        if (isChecked) {
            if (productQuoteIndex === -1) {
                updatedProductsToQuote.push({
                    productId: reqProduct.productId,
                    productName: reqProduct.productName,
                    originalRequiredQuantity: reqProduct.requiredQuantity,
                    quotedQuantity: reqProduct.requiredQuantity,
                });
            }
        } else {
            if (productQuoteIndex !== -1) {
                updatedProductsToQuote.splice(productQuoteIndex, 1);
            }
        }
        
        formInstance.setValue(
            `suppliersToQuote.${supplierFormIndex}.productsToQuote`, 
            updatedProductsToQuote.length > 0 ? updatedProductsToQuote : undefined,
            { shouldValidate: true }
        );
        formInstance.trigger(`suppliersToQuote`);
    }, [formInstance, supplierFormIndex]);


    return (
        <Card className={cn("mb-2 bg-muted/10", !hasAnyQuotableProduct && "opacity-60")}>
            <CardHeader
                className="p-2 flex flex-row items-center justify-between cursor-pointer hover:bg-muted/20"
                onClick={() => {
                    if (hasAnyQuotableProduct && isSupplierSelected) {
                        onToggleExpand(supplier.id);
                    }
                }}
            >
                <div className="flex items-center space-x-3">
                    <Checkbox
                        id={`supplier-checkbox-${supplier.id}`}
                        checked={isSupplierSelected}
                        disabled={!hasAnyQuotableProduct && !isSupplierSelected}
                        onCheckedChange={(checked) => {
                            onToggleSupplier(supplier, !!checked);
                            if (checked && !isExpanded && hasAnyQuotableProduct) {
                                onToggleExpand(supplier.id);
                            } else if (!checked) {
                                onToggleExpand(supplier.id); // Collapse if unselected
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                    <ShadFormLabelFromHookForm htmlFor={`supplier-checkbox-${supplier.id}`} className={cn("font-semibold text-md cursor-pointer", !hasAnyQuotableProduct && "text-muted-foreground")}>
                        {supplier.name}
                    </ShadFormLabelFromHookForm>
                </div>
                {hasAnyQuotableProduct && isSupplierSelected && (
                    <Button type="button" variant="ghost" size="sm" className="p-1 h-auto">
                        {isExpanded ? <Icons.ChevronUp className="h-4 w-4" /> : <Icons.ChevronDown className="h-4 w-4" />}
                    </Button>
                )}
            </CardHeader>

            {!hasAnyQuotableProduct && (
                <CardContent className="p-2 pt-0 text-xs text-muted-foreground">
                    This supplier does not have active product links for items in this requisition.
                </CardContent>
            )}

            {isSupplierSelected && isExpanded && hasAnyQuotableProduct && (
                <CardContent className="p-2 pl-4 border-t">
                    {isLoadingAllSupplierLinks && !supplierAnalysisData[supplier.id] ? (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-3/4 mb-2" />
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-6 w-1/2" />
                            <Skeleton className="h-24 w-full" />
                        </div>
                    ) : requisitionRequiredProducts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No products in this requisition to quote.</p>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-xs font-medium text-muted-foreground">Select products and set quantities for {supplier.name}:</p>
                            {requisitionRequiredProducts.map((reqProduct) => {
                                const productAnalysis = supplierAnalysisData[supplier.id]?.[reqProduct.productId];
                                const link = productAnalysis?.link || null;
                                const canQuoteThisProduct = productAnalysis?.canQuoteProduct || false;
                                const priceAnalysis = productAnalysis?.priceAnalysis || {};

                                const currentProductsArray = formInstance.getValues(`suppliersToQuote.${supplierFormIndex}.productsToQuote`) || [];
                                const currentProductQuoteIndex = currentProductsArray.findIndex(p => p.productId === reqProduct.productId);
                                const productIsSelectedForThisSupplier = currentProductQuoteIndex !== -1;

                                const currentQuotedQuantityValue = productIsSelectedForThisSupplier 
                                    ? formInstance.getValues(`suppliersToQuote.${supplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`) 
                                    : reqProduct.requiredQuantity;
                                
                                const numericWatchedQty = Number(currentQuotedQuantityValue);
                                const applicableRangeForWatchedQty = getApplicablePriceRange(numericWatchedQty, link?.priceRanges);

                                return (
                                    <div key={reqProduct.productId} className="p-3 rounded-md border bg-background relative">
                                        <div className="flex items-start space-x-3">
                                            <Checkbox
                                                id={`supplier-${supplier.id}-product-${reqProduct.productId}`}
                                                disabled={!canQuoteThisProduct}
                                                checked={productIsSelectedForThisSupplier}
                                                onCheckedChange={(checked) => {
                                                    toggleProductForSupplierInForm(reqProduct, !!checked);
                                                }}
                                            />
                                            <div className="flex-1 space-y-1">
                                                <ShadFormLabelFromHookForm htmlFor={`supplier-${supplier.id}-product-${reqProduct.productId}`} className="font-normal text-sm cursor-pointer">
                                                    {reqProduct.productName} (Original Req: {reqProduct.requiredQuantity})
                                                </ShadFormLabelFromHookForm>
                                                {!canQuoteThisProduct && (
                                                    <p className="text-xs text-destructive">This supplier does not offer this product or it's unavailable.</p>
                                                )}
                                            </div>
                                        </div>

                                        {productIsSelectedForThisSupplier && canQuoteThisProduct && currentProductQuoteIndex !== -1 && (
                                            <div className="mt-2 pl-8 space-y-2">
                                                <FormField
                                                    control={formInstance.control}
                                                    name={`suppliersToQuote.${supplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <ShadFormLabelFromHookForm className="text-xs">Quoted Quantity*</ShadFormLabelFromHookForm>
                                                            <FormControl>
                                                                <Input type="number" {...field} className="h-8 text-sm" />
                                                            </FormControl>
                                                            <ShadFormMessage className="text-xs" />
                                                        </FormItem>
                                                    )}
                                                />
                                                {link?.priceRanges && link.priceRanges.length > 0 && (
                                                    <div className="mt-1 text-xs">
                                                        {priceAnalysis.currentPricePerUnit !== null && priceAnalysis.currentRange && (
                                                            <p>
                                                                Price for Original Req. Qty ({reqProduct.requiredQuantity}): <span className="font-semibold">${priceAnalysis.currentPricePerUnit.toFixed(2)}/unit</span>
                                                                (Range: {priceAnalysis.currentRange.minQuantity}
                                                                {priceAnalysis.currentRange.maxQuantity ? `-${priceAnalysis.currentRange.maxQuantity}` : '+'})
                                                            </p>
                                                        )}
                                                        {priceAnalysis.nextBetterRange && priceAnalysis.quantityToReachNextBetter !== null && priceAnalysis.nextBetterRange.price !== null && (
                                                            <p className="text-green-600 font-medium">
                                                                Tip: Order {priceAnalysis.nextBetterRange.minQuantity} (add {priceAnalysis.quantityToReachNextBetter}) for ${priceAnalysis.nextBetterRange.price.toFixed(2)}/unit.
                                                            </p>
                                                        )}
                                                        {priceAnalysis.alternativeNextRange && !priceAnalysis.currentRange && priceAnalysis.alternativeNextRange.price !== null && (
                                                            <p className="text-blue-600">
                                                                Note: First available price is ${priceAnalysis.alternativeNextRange.price.toFixed(2)}/unit for {priceAnalysis.alternativeNextRange.minQuantity} units.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                                {link?.priceRanges && link.priceRanges.length > 0 && (
                                                    <div className="mt-3 space-y-1">
                                                        <p className="text-xs font-medium text-muted-foreground">Available Price Tiers for this Supplier:</p>
                                                        <ul className="list-none pl-0 text-xs">
                                                            {link.priceRanges.map((range, rangeIdx) => {
                                                                const isRangeActive = applicableRangeForWatchedQty &&
                                                                    range.minQuantity === applicableRangeForWatchedQty.minQuantity &&
                                                                    range.maxQuantity === applicableRangeForWatchedQty.maxQuantity &&
                                                                    range.price === applicableRangeForWatchedQty.price &&
                                                                    range.priceType === applicableRangeForWatchedQty.priceType;
                                                                return (
                                                                    <li
                                                                        key={rangeIdx}
                                                                        className={cn(
                                                                            "py-0.5 px-1.5 rounded-sm my-0.5",
                                                                            isRangeActive
                                                                                ? "bg-primary/20 text-primary font-semibold ring-1 ring-primary" 
                                                                                : "bg-muted/50"
                                                                        )}
                                                                    >
                                                                        Qty: {range.minQuantity}{range.maxQuantity ? `-${range.maxQuantity}` : '+'}
                                                                        {range.priceType === 'fixed' && range.price !== null ? ` - $${Number(range.price).toFixed(2)}/unit` : ` - ${range.priceType}`}
                                                                        {range.additionalConditions && <span className="text-muted-foreground text-[10px]"> ({range.additionalConditions})</span>}
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {formInstance.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote && (
                                <ShadFormMessage className="mt-1 text-xs">
                                    {typeof formInstance.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote?.message === 'string'
                                        ? formInstance.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote?.message
                                        : "Error with product selection for this supplier."
                                    }
                                </ShadFormMessage>
                            )}
                             {(formInstance.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote as any)?.root?.message && (
                                <ShadFormMessage className="mt-1 text-xs">
                                {(formInstance.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote as any)?.root?.message}
                                </ShadFormMessage>
                            )}
                        </div>
                    )}
                </CardContent>
            )}
        </Card>
    );
};
