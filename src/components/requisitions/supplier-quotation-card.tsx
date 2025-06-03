import React, { useCallback, useMemo } from 'react';
import { Control, useFieldArray, useWatch } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, FormControl, FormItem, FormLabel as ShadFormLabelFromHookForm, FormMessage as ShadFormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Icons } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Requisition, Supplier, ProveedorProducto, PriceRange, RequiredProduct as RequisitionRequiredProductType } from "@/types";
import { Button } from '@/components/ui/button';

// --- Tipos para la validación del formulario (copiados de RequisitionDetailPage) ---
const quotedProductSchema = {
    productId: '', // Not used for zod, but for type inference
    productName: '',
    originalRequiredQuantity: 0,
    quotedQuantity: 0,
};
type QuotedProductFormData = typeof quotedProductSchema; // Simplified type for internal use

const supplierQuoteDetailSchema = {
    supplierId: '',
    supplierName: '',
    productsToQuote: [] as QuotedProductFormData[],
};
type SupplierQuoteDetailFormData = typeof supplierQuoteDetailSchema;

interface QuotationRequestFormData {
    suppliersToQuote: SupplierQuoteDetailFormData[];
    responseDeadline: Date;
    notes?: string;
}
// --- Fin Tipos ---

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
    formControl: Control<QuotationRequestFormData>;
    supplierFormIndex: number; // El índice de este proveedor en el array 'suppliersToQuote' de RHF
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
    formControl,
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
        control: formControl,
        name: `suppliersToQuote.${supplierFormIndex}.productsToQuote`,
    });

    // Determine if supplier has any quotable products from the requisition
    const hasAnyQuotableProduct = useMemo(() => {
        return requisitionRequiredProducts.some(
            rp => supplierAnalysisData[supplier.id]?.[rp.productId]?.canQuoteProduct
        );
    }, [requisitionRequiredProducts, supplier.id, supplierAnalysisData]);


    const toggleProductForSupplierInForm = useCallback((
        reqProduct: RequisitionRequiredProductType,
        isChecked: boolean
    ) => {
        const productQuoteIndex = productsToQuoteFields.findIndex(p => p.productId === reqProduct.productId);

        if (isChecked) {
            if (productQuoteIndex === -1) {
                appendProduct({
                    productId: reqProduct.productId,
                    productName: reqProduct.productName,
                    originalRequiredQuantity: reqProduct.requiredQuantity,
                    quotedQuantity: reqProduct.requiredQuantity,
                });
            }
        } else {
            if (productQuoteIndex !== -1) {
                removeProduct(productQuoteIndex);
            }
        }
        // Force validation on the specific nested array and the main suppliers array
        // This ensures superRefine logic is re-evaluated immediately
        formControl.trigger(`suppliersToQuote.${supplierFormIndex}.productsToQuote`);
        formControl.trigger(`suppliersToQuote`);
    }, [appendProduct, removeProduct, productsToQuoteFields, supplierFormIndex, formControl]);


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
                        disabled={!hasAnyQuotableProduct && !isSupplierSelected} // Disable if no quotable products, unless already selected (to allow unselecting)
                        onCheckedChange={(checked) => {
                            onToggleSupplier(supplier, !!checked);
                            if (checked && !isExpanded && hasAnyQuotableProduct) {
                                onToggleExpand(supplier.id);
                            } else if (!checked) {
                                onToggleExpand(supplier.id);
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
                    Este proveedor no tiene enlaces de productos activos para los artículos en esta solicitud.
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
                        <p className="text-xs text-muted-foreground">No hay productos en esta solicitud para cotizar.</p>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-xs font-medium text-muted-foreground">Selecciona productos y establece cantidades para {supplier.name}:</p>
                            {requisitionRequiredProducts.map((reqProduct) => {
                                const productAnalysis = supplierAnalysisData[supplier.id]?.[reqProduct.productId];
                                const link = productAnalysis?.link || null;
                                const canQuoteThisProduct = productAnalysis?.canQuoteProduct || false;
                                const priceAnalysis = productAnalysis?.priceAnalysis || {};

                                const productIsSelectedForThisSupplier = productsToQuoteFields.some(p => p.productId === reqProduct.productId);
                                const currentProductQuoteIndex = productsToQuoteFields.findIndex(p => p.productId === reqProduct.productId);

                                // Use useWatch for the specific field to avoid re-rendering the whole form
                                const watchedQuotedQuantity = useWatch({
                                    control: formControl,
                                    name: `suppliersToQuote.${supplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`,
                                    defaultValue: reqProduct.requiredQuantity, // Provide a default if it's not yet in the form state
                                });

                                const numericWatchedQty = Number(watchedQuotedQuantity);
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
                                                    {reqProduct.productName} (Req. Original: {reqProduct.requiredQuantity})
                                                </ShadFormLabelFromHookForm>
                                                {!canQuoteThisProduct && (
                                                    <p className="text-xs text-destructive">Este proveedor no ofrece este producto o no está disponible.</p>
                                                )}
                                            </div>
                                        </div>

                                        {productIsSelectedForThisSupplier && canQuoteThisProduct && currentProductQuoteIndex !== -1 && (
                                            <div className="mt-2 pl-8 space-y-2">
                                                <FormField
                                                    control={formControl}
                                                    name={`suppliersToQuote.${supplierFormIndex}.productsToQuote.${currentProductQuoteIndex}.quotedQuantity`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <ShadFormLabelFromHookForm className="text-xs">Cantidad Cotizada*</ShadFormLabelFromHookForm>
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
                                                                Precio Original Req.: <span className="font-semibold">${priceAnalysis.currentPricePerUnit.toFixed(2)}/unidad</span>
                                                                (Cant: {priceAnalysis.currentRange.minQuantity}
                                                                {priceAnalysis.currentRange.maxQuantity ? `-${priceAnalysis.currentRange.maxQuantity}` : '+'})
                                                            </p>
                                                        )}
                                                        {priceAnalysis.nextBetterRange && priceAnalysis.quantityToReachNextBetter !== null && priceAnalysis.nextBetterRange.price !== null && (
                                                            <p className="text-green-600 font-medium">
                                                                Sugerencia: Pide {priceAnalysis.nextBetterRange.minQuantity} (añade {priceAnalysis.quantityToReachNextBetter}) por ${priceAnalysis.nextBetterRange.price.toFixed(2)}/unidad.
                                                            </p>
                                                        )}
                                                        {priceAnalysis.alternativeNextRange && !priceAnalysis.currentRange && priceAnalysis.alternativeNextRange.price !== null && (
                                                            <p className="text-blue-600">
                                                                Nota: Primer precio disponible es ${priceAnalysis.alternativeNextRange.price.toFixed(2)}/unidad para {priceAnalysis.alternativeNextRange.minQuantity} unidades.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                                {link?.priceRanges && link.priceRanges.length > 0 && (
                                                    <div className="mt-3 space-y-1">
                                                        <p className="text-xs font-medium text-muted-foreground">Niveles de precios disponibles para este proveedor:</p>
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
                                                                                ? "bg-primary/20 text-primary-foreground font-semibold ring-1 ring-primary"
                                                                                : "bg-muted/50"
                                                                        )}
                                                                    >
                                                                        Cant: {range.minQuantity}{range.maxQuantity ? `-${range.maxQuantity}` : '+'}
                                                                        {range.priceType === 'fixed' && range.price !== null ? ` - $${Number(range.price).toFixed(2)}/unidad` : ` - ${range.priceType}`}
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
                            {formControl.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote && (
                                <ShadFormMessage className="mt-1 text-xs">
                                    {typeof formControl.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote?.message === 'string'
                                        ? formControl.formState.errors.suppliersToQuote?.[supplierFormIndex]?.productsToQuote?.message
                                        : "Error con la selección de productos para este proveedor."
                                    }
                                </ShadFormMessage>
                            )}
                        </div>
                    )}
                </CardContent>
            )}
        </Card>
    );
};