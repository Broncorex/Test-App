"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";
import type { PurchaseOrder, SupplierSolutionType } from "@/types";
import { SUPPLIER_SOLUTION_TYPES } from "@/types";
import { recordSupplierSolution, type RecordSupplierSolutionData } from "@/services/purchaseOrderService";

const supplierSolutionFormSchema = z.object({
  solutionType: z.enum(SUPPLIER_SOLUTION_TYPES, {
    required_error: "Supplier solution type is required.",
  }),
  solutionDetails: z.string().min(10, {
    message: "Please provide at least 10 characters of detail for the solution.",
  }),
  discountAmount: z.union([
    z.number().positive({message: "Discount amount must be a positive number."}),
    z.string().transform((val) => val === "" ? undefined : parseFloat(val)),
    z.undefined()
  ]).optional(),
}).superRefine((data, ctx) => {
  if (data.solutionType === "DiscountForImperfection") {
    if (data.discountAmount === undefined || data.discountAmount === null || data.discountAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount amount is required and must be positive for 'Discount For Imperfection'.",
        path: ["discountAmount"],
      });
    }
  }
});

type SupplierSolutionFormData = z.infer<typeof supplierSolutionFormSchema>;

interface RecordSupplierSolutionModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  purchaseOrder: PurchaseOrder | null;
  currentUserId: string | undefined;
  onSolutionRecorded: () => void; 
}

export function RecordSupplierSolutionModal({
  isOpen,
  onOpenChange,
  purchaseOrder,
  currentUserId,
  onSolutionRecorded,
}: RecordSupplierSolutionModalProps) {
  const { toast } = useToast();
  const [isSubmittingSolution, setIsSubmittingSolution] = useState(false);

  const form = useForm<SupplierSolutionFormData>({
    resolver: zodResolver(supplierSolutionFormSchema),
    defaultValues: {
      solutionType: undefined,
      solutionDetails: "",
      discountAmount: undefined,
    },
  });

  const watchedSolutionType = form.watch("solutionType");

  useEffect(() => {
    if (isOpen && purchaseOrder) {
      form.reset({
        solutionType: purchaseOrder.supplierAgreedSolutionType || undefined,
        solutionDetails: purchaseOrder.supplierAgreedSolutionDetails || "",
        discountAmount: undefined,
      });
    }
  }, [isOpen, purchaseOrder, form]);

  useEffect(() => {
    if (watchedSolutionType !== "DiscountForImperfection") {
      form.setValue("discountAmount", undefined);
      form.clearErrors("discountAmount");
    }
  }, [watchedSolutionType, form]);

  async function onSubmit(data: SupplierSolutionFormData) {
    if (!purchaseOrder || !currentUserId) {
      toast({
        title: "Error",
        description: "Missing Purchase Order ID or User ID.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmittingSolution(true);
    try {
      const payload: RecordSupplierSolutionData = {
        supplierAgreedSolutionType: data.solutionType,
        supplierAgreedSolutionDetails: data.solutionDetails,
      };
      if (data.solutionType === "DiscountForImperfection" && data.discountAmount) {
        payload.discountAmount = data.discountAmount;
      }

      await recordSupplierSolution(purchaseOrder.id, payload, currentUserId);
      toast({
        title: "Supplier Solution Recorded",
        description: `Solution '${data.solutionType}' has been recorded.`,
      });
      onOpenChange(false); 
      onSolutionRecorded(); 
    } catch (error: any) {
      console.error("Error recording supplier solution:", error);
      toast({
        title: "Solution Update Failed",
        description: error.message || "Could not record supplier solution.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingSolution(false);
    }
  }

  if (!purchaseOrder) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle className="font-headline">Record Supplier Solution</DialogTitle>
              <DialogDescription>
                Document the agreed solution for discrepancies in PO: {purchaseOrder.id.substring(0, 8)}...
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="solutionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Solution Type *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select solution type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SUPPLIER_SOLUTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type.replace(/([A-Z])/g, ' $1').trim()} 
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {watchedSolutionType === "DiscountForImperfection" && (
                <FormField
                  control={form.control}
                  name="discountAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount Amount ($) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g., 50.00"
                          step="0.01"
                          value={field.value || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "") {
                              field.onChange(undefined);
                            } else {
                              const numValue = parseFloat(value);
                              if (!isNaN(numValue)) {
                                field.onChange(numValue);
                              }
                            }
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="solutionDetails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Solution Details *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the agreed solution, e.g., credit amount, discount terms, new ETA for missing items."
                        {...field}
                        rows={4}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmittingSolution}>
                {isSubmittingSolution ? (
                  <Icons.Logo className="animate-spin mr-2" />
                ) : (
                  <Icons.Check className="mr-2" />
                )}
                {isSubmittingSolution ? "Saving..." : "Save Solution"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}