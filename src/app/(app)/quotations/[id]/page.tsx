
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getQuotationById, updateQuotationStatus, receiveQuotation, type UpdateReceivedQuotationData, getAllQuotations } from "@/services/quotationService";
import type { Quotation, QuotationStatus, QuotationDetail, QuotationAdditionalCost, Product } from "@/types";
import { QUOTATION_STATUSES, QUOTATION_ADDITIONAL_COST_TYPES } from "@/types";
import { Timestamp } from "firebase/firestore";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icons } from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isValid } from "date-fns";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Label as ShadLabel } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


const receivedQuotationItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  requiredQuantity: z.number(),
  quotedQuantity: z.coerce.number().min(0, "Quoted quantity must be non-negative."),
  unitPriceQuoted: z.coerce.number().min(0, "Unit price must be non-negative."),
  conditions: z.string().optional(),
  estimatedDeliveryDate: z.date({ required_error: "Estimated delivery date is required." }),
  notes: z.string().optional(),
});

const additionalCostSchema = z.object({
  description: z.string().min(1, "Description is required."),
  amount: z.coerce.number().min(0, "Amount must be non-negative."),
  type: z.enum(QUOTATION_ADDITIONAL_COST_TYPES, { required_error: "Cost type is required." }),
});

const receiveQuotationFormSchema = z.object({
  receivedDate: z.date({ required_error: "Received date is required." }),
  productsSubtotal: z.coerce.number().min(0),
  additionalCosts: z.array(additionalCostSchema).optional(),
  totalQuotation: z.coerce.number().min(0),
  shippingConditions: z.string().min(1, "Shipping conditions are required."),
  notes: z.string().optional(),
  details: z.array(receivedQuotationItemSchema).min(1, "At least one item detail is required."),
});

type ReceiveQuotationFormData = z.infer<typeof receiveQuotationFormSchema>;


export default function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const quotationId = params.id as string;
  const { toast } = useToast();
  const { appUser, role, currentUser } = useAuth();

  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<QuotationStatus | undefined>(undefined);
  
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = useState(false);
  const [isSubmittingReceive, setIsSubmittingReceive] = useState(false);
  
  const [canCompare, setCanCompare] = useState(false);
  const [isLoadingCanCompare, setIsLoadingCanCompare] = useState(true);


  const receiveForm = useForm<ReceiveQuotationFormData>({
    resolver: zodResolver(receiveQuotationFormSchema),
    defaultValues: {
      receivedDate: new Date(),
      productsSubtotal: 0,
      additionalCosts: [],
      totalQuotation: 0,
      shippingConditions: "",
      notes: "",
      details: [],
    },
  });

  const { fields: additionalCostFields, append: appendAdditionalCost, remove: removeAdditionalCost } = useFieldArray({
    control: receiveForm.control,
    name: "additionalCosts",
  });

  const fetchQuotationData = useCallback(async () => {
    if (!quotationId || !appUser) return;
    setIsLoading(true);
    setIsLoadingCanCompare(true);
    try {
      const fetchedQuotation = await getQuotationById(quotationId);
      if (fetchedQuotation) {
        setQuotation(fetchedQuotation);
        setSelectedStatus(fetchedQuotation.status);

        if (fetchedQuotation.status === "Sent" || fetchedQuotation.status === "Received") {
          const detailsForForm = fetchedQuotation.quotationDetails?.map(d => ({
            productId: d.productId,
            productName: d.productName,
            requiredQuantity: d.requiredQuantity,
            quotedQuantity: d.quotedQuantity ?? d.requiredQuantity,
            unitPriceQuoted: d.unitPriceQuoted ?? 0,
            conditions: d.conditions ?? "",
            estimatedDeliveryDate: d.estimatedDeliveryDate?.toDate() ?? (fetchedQuotation.responseDeadline?.toDate() || new Date()),
            notes: d.notes ?? "",
          })) || [];
          
          receiveForm.reset({
            receivedDate: fetchedQuotation.receivedDate?.toDate() || new Date(),
            productsSubtotal: fetchedQuotation.productsSubtotal ?? 0,
            additionalCosts: fetchedQuotation.additionalCosts?.map(ac => ({...ac, amount: Number(ac.amount)})) || [],
            totalQuotation: fetchedQuotation.totalQuotation ?? 0,
            shippingConditions: fetchedQuotation.shippingConditions ?? "",
            notes: fetchedQuotation.notes || "",
            details: detailsForForm,
          });
        }
        
        if (fetchedQuotation.requisitionId && ["Received", "Awarded", "Partially Awarded", "Lost", "Sent"].includes(fetchedQuotation.status)) {
             const allQuotesForRequisition = await getAllQuotations({ requisitionId: fetchedQuotation.requisitionId });
             const otherRelevantQuotes = allQuotesForRequisition.filter(q => 
                q.id !== fetchedQuotation.id && 
                ["Received", "Awarded", "Partially Awarded", "Lost"].includes(q.status) 
             );
             setCanCompare(otherRelevantQuotes.length > 0 || allQuotesForRequisition.filter(q => ["Received", "Awarded", "Partially Awarded", "Lost"].includes(q.status)).length > 1);
        } else {
            setCanCompare(false);
        }

      } else {
        toast({ title: "Error", description: "Quotation not found.", variant: "destructive" });
        router.replace("/quotations");
      }
    } catch (error) {
      console.error("Error fetching quotation details:", error);
      toast({ title: "Error", description: "Failed to fetch quotation details.", variant: "destructive" });
    }
    setIsLoading(false);
    setIsLoadingCanCompare(false);
  }, [quotationId, appUser, router, toast, receiveForm]);

  useEffect(() => {
    fetchQuotationData();
  }, [fetchQuotationData]);

  const watchedDetails = receiveForm.watch("details");
  const watchedAdditionalCosts = receiveForm.watch("additionalCosts");

  useEffect(() => {
    const subtotal = watchedDetails.reduce((sum, item) => sum + (Number(item.quotedQuantity) * Number(item.unitPriceQuoted)), 0);
    receiveForm.setValue("productsSubtotal", subtotal);
    
    const totalCosts = watchedAdditionalCosts?.reduce((sum, cost) => sum + Number(cost.amount), 0) || 0;
    receiveForm.setValue("totalQuotation", subtotal + totalCosts);
  }, [watchedDetails, watchedAdditionalCosts, receiveForm]);


  const handleStatusUpdate = async (newStatus?: QuotationStatus) => {
    const statusToUpdate = newStatus || selectedStatus;
    if (!quotation || !statusToUpdate || statusToUpdate === quotation.status || !currentUser) return;
    if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update the status.", variant: "destructive" });
      return;
    }
    setIsUpdatingStatus(true);
    try {
      await updateQuotationStatus(quotationId, statusToUpdate, currentUser.uid);
      setQuotation(prev => prev ? { ...prev, status: statusToUpdate, updatedAt: Timestamp.now() } : null);
      setSelectedStatus(statusToUpdate); 
      toast({ title: "Status Updated", description: `Quotation status changed to ${statusToUpdate}.` });
      fetchQuotationData(); 
    } catch (error) {
      console.error("Error updating quotation status:", error);
      toast({ title: "Update Failed", description: "Could not update quotation status.", variant: "destructive" });
    }
    setIsUpdatingStatus(false);
  };
  
  const handleReceiveQuotationSubmit = async (data: ReceiveQuotationFormData) => {
    if (!quotation || !currentUser) return;
    setIsSubmittingReceive(true);
    try {
      const payload: UpdateReceivedQuotationData = {
        ...data,
        receivedDate: Timestamp.fromDate(data.receivedDate),
        additionalCosts: data.additionalCosts?.map(ac => ({...ac, amount: Number(ac.amount)})) || [],
        details: data.details.map(d => ({
          ...d,
          estimatedDeliveryDate: Timestamp.fromDate(d.estimatedDeliveryDate),
          unitPriceQuoted: Number(d.unitPriceQuoted),
          quotedQuantity: Number(d.quotedQuantity),
        })),
      };
      await receiveQuotation(quotationId, payload, currentUser.uid);
      toast({ title: "Quotation Response Saved", description: "Supplier response has been recorded."});
      setIsReceiveDialogOpen(false);
      fetchQuotationData(); 
    } catch (error: any) {
      console.error("Error submitting received quotation:", error);
      toast({ title: "Submission Failed", description: error.message || "Could not record supplier response.", variant: "destructive" });
    }
    setIsSubmittingReceive(false);
  };

  const formatTimestampDate = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    let date: Date;
    if (timestamp instanceof Timestamp) {
      date = timestamp.toDate();
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    } else {
      return "Invalid Date";
    }
    return isValid(date) ? format(date, "PPP") : "Invalid Date";
  };
  
  const getStatusBadgeVariant = (status?: QuotationStatus) => {
    if (!status) return "secondary";
    switch (status) {
      case "Sent": return "outline";
      case "Received": return "default";
      case "Awarded": return "default"; 
      case "Partially Awarded": return "default"; 
      case "Rejected":
      case "Lost":
        return "destructive";
      default: return "secondary";
    }
  };
   const getStatusBadgeClass = (status?: QuotationStatus) => {
    if (!status) return "";
    switch (status) {
      case "Awarded": return "bg-green-500 hover:bg-green-600 text-white";
      case "Partially Awarded": return "bg-yellow-400 hover:bg-yellow-500 text-black";
      default: return "";
    }
  };


  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Quotation Details" description="Loading quotation information..." />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="space-y-4">
        <PageHeader title="Quotation Not Found" description="The requested quotation could not be loaded." />
        <Button onClick={() => router.push("/quotations")} variant="outline">Back to List</Button>
      </div>
    );
  }

  const canManage = role === 'admin' || role === 'superadmin';
  const canEditRequestDetails = canManage && quotation.status === "Sent";
  const canEnterOrEditResponse = canManage && (quotation.status === "Sent" || quotation.status === "Received");
  const canAward = canManage && (quotation.status === "Received" || quotation.status === "Partially Awarded");
  const canReject = canManage && (quotation.status === "Received" || quotation.status === "Partially Awarded");

  const totalAdditionalCostsValue = quotation.additionalCosts?.reduce((sum, cost) => sum + Number(cost.amount), 0) || 0;


  return (
    <>
      <PageHeader
        title={`Quotation: ${quotation.id.substring(0,8)}...`}
        description={`For Requisition: ${quotation.requisitionId.substring(0,8)}... | Supplier: ${quotation.supplierName || quotation.supplierId}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            {canEditRequestDetails && (
                 <Button onClick={() => console.log("Edit Quotation Request Details - TBD. Modal similar to Supplier Response but for request fields.")} variant="outline">
                    <Icons.Edit className="mr-2 h-4 w-4" /> Edit Quotation Request
                </Button>
            )}
            {canEnterOrEditResponse && (
              <Button onClick={() => setIsReceiveDialogOpen(true)} variant={quotation.status === "Sent" ? "default" : "outline"}>
                <Icons.Package className="mr-2 h-4 w-4" /> 
                {quotation.status === "Sent" ? "Enter Supplier Response" : "Edit Supplier Response"}
              </Button>
            )}
             {canAward && (
              <Button onClick={() => handleStatusUpdate("Awarded")} className="bg-green-500 hover:bg-green-600 text-white">
                <Icons.DollarSign className="mr-2 h-4 w-4" /> Award Quotation
              </Button>
            )}
            {canReject && (
              <Button onClick={() => handleStatusUpdate("Rejected")} variant="destructive">
                <Icons.Delete className="mr-2 h-4 w-4" /> Reject Quotation
              </Button>
            )}
            <Button onClick={() => router.back()} variant="outline">Back to List</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">Quotation Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Quotation ID:</span><span className="font-medium truncate max-w-[150px]">{quotation.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Requisition ID:</span>
              <Link href={`/requisitions/${quotation.requisitionId}`} className="font-medium text-primary hover:underline truncate max-w-[150px]">
                {quotation.requisitionId}
              </Link>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Supplier:</span><span className="font-medium">{quotation.supplierName || "N/A"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Request Date:</span><span className="font-medium">{formatTimestampDate(quotation.requestDate)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Response Deadline:</span><span className="font-medium">{formatTimestampDate(quotation.responseDeadline)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(quotation.status)} className={getStatusBadgeClass(quotation.status)}>
                {quotation.status}
              </Badge>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Requested By:</span><span className="font-medium">{quotation.generatedByUserName || "N/A"}</span></div>
            {quotation.receivedDate && (<div className="flex justify-between"><span className="text-muted-foreground">Received Date:</span><span className="font-medium">{formatTimestampDate(quotation.receivedDate)}</span></div>)}
            
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Products Subtotal:</span><span className="font-medium">${Number(quotation.productsSubtotal || 0).toFixed(2)}</span></div>
            
            {(quotation.additionalCosts && quotation.additionalCosts.length > 0) || totalAdditionalCostsValue > 0 ? (
              <Accordion type="single" collapsible className="w-full -my-2">
                <AccordionItem value="additional-costs" className="border-b-0">
                  <AccordionTrigger className="py-2 hover:no-underline">
                    <div className="flex justify-between w-full">
                      <span className="text-muted-foreground">Additional Costs:</span>
                      <span className="font-medium">${totalAdditionalCostsValue.toFixed(2)}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-1 pb-2 pl-2 text-xs">
                    <ul className="space-y-0.5">
                      {quotation.additionalCosts?.map((cost, index) => (
                        <li key={index} className="flex justify-between items-center">
                          <span>{cost.description} ({cost.type})</span>
                          <span className="font-medium">${Number(cost.amount).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : (
              <div className="flex justify-between"><span className="text-muted-foreground">Additional Costs:</span><span className="font-medium">$0.00</span></div>
            )}

            <div className="flex justify-between text-md font-semibold pt-1"><span className="text-muted-foreground">Total Quotation:</span><span>${Number(quotation.totalQuotation || 0).toFixed(2)}</span></div>
            <Separator />
            
            <div><span className="text-muted-foreground">Shipping Conditions:</span><p className="font-medium whitespace-pre-wrap">{quotation.shippingConditions || "N/A"}</p></div>
            <div><span className="text-muted-foreground">Notes:</span><p className="font-medium whitespace-pre-wrap">{quotation.notes || "N/A"}</p></div>
            
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{new Date(quotation.updatedAt.seconds * 1000).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{quotation.generatedByUserName || quotation.createdBy}</span></div>

          </CardContent>
           {canManage && (
            <CardFooter className="border-t pt-4">
                <div className="w-full space-y-2">
                    <ShadLabel htmlFor="status-update" className="font-semibold">Update Status:</ShadLabel>
                    <div className="flex gap-2">
                    <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as QuotationStatus)}>
                        <SelectTrigger id="status-update" className="flex-1">
                        <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                        {QUOTATION_STATUSES.map(s => (
                            <SelectItem key={s} value={s} disabled={s === "Sent" && quotation.status !== "Sent" }>{s}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={() => handleStatusUpdate()} disabled={isUpdatingStatus || selectedStatus === quotation.status}>
                        {isUpdatingStatus ? <Icons.Logo className="animate-spin" /> : "Save"}
                    </Button>
                    </div>
                </div>
            </CardFooter>
           )}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Quoted Products</CardTitle>
            <CardDescription>List of products and their quoted details for this quotation.</CardDescription>
          </CardHeader>
          <CardContent>
            {quotation.quotationDetails && quotation.quotationDetails.length > 0 ? (
              <ScrollArea className="h-[calc(100vh-20rem)]"> 
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Req. Qty</TableHead>
                      <TableHead className="text-right">Quoted Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead>Delivery ETA</TableHead>
                      <TableHead>Conditions</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotation.quotationDetails.map((item) => (
                      <TableRow key={item.id || item.productId}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.requiredQuantity}</TableCell>
                        <TableCell className="text-right">{item.quotedQuantity ?? "N/A"}</TableCell>
                        <TableCell className="text-right">${Number(item.unitPriceQuoted ?? 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">${(Number(item.quotedQuantity ?? 0) * Number(item.unitPriceQuoted ?? 0)).toFixed(2)}</TableCell>
                        <TableCell>{formatTimestampDate(item.estimatedDeliveryDate)}</TableCell>
                        <TableCell className="whitespace-pre-wrap text-xs max-w-[100px] truncate" title={item.conditions}>{item.conditions || "N/A"}</TableCell>
                        <TableCell className="whitespace-pre-wrap text-xs max-w-[100px] truncate" title={item.notes}>{item.notes || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <p>No products listed for this quotation, or details not yet received.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {quotation.requisitionId && (role === 'admin' || role === 'superadmin') && (
        <Card className="mt-6 md:col-span-3">
          <CardHeader>
            <CardTitle className="font-headline">Compare Quotations for this Requisition</CardTitle>
          </CardHeader>
          <CardContent>
             {isLoadingCanCompare ? (<Skeleton className="h-10 w-64" />) : 
             canCompare ? (
                <Button asChild variant="outline">
                    <Link href={`/requisitions/${quotation.requisitionId}/compare-quotations?currentQuoteId=${quotation.id}`}>
                        <Icons.LayoutList className="mr-2 h-4 w-4" />
                        Compare All Received Quotations
                    </Link>
                </Button>
             ) : (
                <p className="text-sm text-muted-foreground">No other relevant quotations found to compare for this requisition at the moment.</p>
             )}
          </CardContent>
        </Card>
      )}


      <Dialog open={isReceiveDialogOpen} onOpenChange={setIsReceiveDialogOpen}>
        <DialogContent className="sm:max-w-4xl flex flex-col max-h-[90vh]">
          <Form {...receiveForm}>
            <form onSubmit={receiveForm.handleSubmit(handleReceiveQuotationSubmit)} className="flex flex-col flex-grow min-h-0">
              <DialogHeader>
                <DialogTitle className="font-headline">
                  {quotation.status === "Sent" ? "Enter Supplier Quotation Response" : "Edit Supplier Quotation Response"}
                </DialogTitle>
                <DialogDescription>
                  Fill in the details received from the supplier: {quotation.supplierName || quotation.supplierId}. <br/>
                  For Requisition: {quotation.requisitionId.substring(0,8)}...
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-grow overflow-y-auto min-h-0 py-4 pr-2 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={receiveForm.control} name="receivedDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Date Received *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )} />
                  <FormField control={receiveForm.control} name="shippingConditions"
                    render={({ field }) => (<FormItem><FormLabel>Shipping Conditions *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                </div>

                <Card>
                  <CardHeader className="p-3"><CardTitle className="text-lg">Quoted Items</CardTitle></CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {receiveForm.getValues('details').map((item, index) => (
                      <div key={item.productId} className="p-3 border rounded-md space-y-3 bg-muted/30">
                        <h4 className="font-semibold">{item.productName} (Required: {item.requiredQuantity})</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <FormField control={receiveForm.control} name={`details.${index}.quotedQuantity`}
                            render={({ field }) => (<FormItem><FormLabel>Quoted Qty*</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={receiveForm.control} name={`details.${index}.unitPriceQuoted`}
                            render={({ field }) => (<FormItem><FormLabel>Unit Price*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                           <FormField control={receiveForm.control} name={`details.${index}.estimatedDeliveryDate`}
                            render={({ field }) => (
                              <FormItem className="flex flex-col">
                                <FormLabel>Delivery ETA*</FormLabel>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <FormControl>
                                      <Button variant={"outline"} className={cn("pl-3 text-left font-normal w-full", !field.value && "text-muted-foreground")}>
                                        {field.value ? format(field.value, "PPP") : <span>Pick ETA</span>}
                                        <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                                      </Button>
                                    </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                                  </PopoverContent>
                                </Popover>
                                <FormMessage />
                              </FormItem>
                            )} />
                        </div>
                        <FormField control={receiveForm.control} name={`details.${index}.conditions`}
                          render={({ field }) => (<FormItem><FormLabel>Item Conditions</FormLabel><FormControl><Textarea placeholder="e.g., Warranty, minimum order" {...field} rows={2}/></FormControl><FormMessage /></FormItem>)} />
                        <FormField control={receiveForm.control} name={`details.${index}.notes`}
                          render={({ field }) => (<FormItem><FormLabel>Item Notes</FormLabel><FormControl><Textarea placeholder="e.g., Alternative offered" {...field} rows={2}/></FormControl><FormMessage /></FormItem>)} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="p-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">Additional Costs</CardTitle>
                    <Button type="button" variant="outline" size="sm" onClick={() => appendAdditionalCost({ description: "", amount: 0, type: "other" })}>
                      <Icons.Add className="mr-2 h-4 w-4"/> Add Cost
                    </Button>
                  </CardHeader>
                  <CardContent className="p-3 space-y-3">
                    {additionalCostFields.map((item, index) => (
                      <div key={item.id} className="p-3 border rounded-md space-y-2 bg-muted/30 relative">
                        <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => removeAdditionalCost(index)}><Icons.Delete className="h-4 w-4 text-destructive"/></Button>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                           <FormField control={receiveForm.control} name={`additionalCosts.${index}.description`}
                            render={({ field }) => (<FormItem><FormLabel>Description*</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                           <FormField control={receiveForm.control} name={`additionalCosts.${index}.amount`}
                            render={({ field }) => (<FormItem><FormLabel>Amount*</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)} />
                           <FormField control={receiveForm.control} name={`additionalCosts.${index}.type`}
                            render={({ field }) => (<FormItem><FormLabel>Type*</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                                <SelectContent>{QUOTATION_ADDITIONAL_COST_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}</SelectContent>
                              </Select><FormMessage /></FormItem>)}/>
                        </div>
                      </div>
                    ))}
                    {additionalCostFields.length === 0 && <p className="text-sm text-muted-foreground">No additional costs added.</p>}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 border rounded-md bg-card">
                    <FormField control={receiveForm.control} name="productsSubtotal"
                        render={({ field }) => (<FormItem><FormLabel>Calculated Products Subtotal</FormLabel><FormControl><Input type="number" {...field} readOnly className="font-semibold text-muted-foreground bg-muted/50" /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={receiveForm.control} name="totalQuotation"
                        render={({ field }) => (<FormItem><FormLabel>Calculated Total Quotation</FormLabel><FormControl><Input type="number" {...field} readOnly className="font-semibold text-primary bg-primary/10" /></FormControl><FormMessage /></FormItem>)} />
                </div>
                
                <FormField control={receiveForm.control} name="notes"
                  render={({ field }) => (<FormItem><FormLabel>Overall Quotation Notes</FormLabel><FormControl><Textarea placeholder="General notes about the received quotation..." {...field} /></FormControl><FormMessage /></FormItem>)} />
              </div>

              <DialogFooter className="pt-4 flex-shrink-0">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingReceive}>
                  {isSubmittingReceive ? <Icons.Logo className="animate-spin"/> : "Save Received Quotation"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

    
