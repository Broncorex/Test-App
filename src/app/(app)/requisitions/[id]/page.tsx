
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth-store";
import { getRequisitionById, updateRequisitionStatus, type UpdateRequisitionData } from "@/services/requisitionService";
import type { Requisition, RequisitionStatus, RequiredProduct, Supplier } from "@/types";
import { REQUISITION_STATUSES } from "@/types";
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
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getAllSuppliers } from "@/services/supplierService";
import { createQuotation, type CreateQuotationRequestData } from "@/services/quotationService";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label"; // Added Label import


const quotationRequestFormSchema = z.object({
  supplierIds: z.array(z.string()).min(1, "At least one supplier must be selected."),
  responseDeadline: z.date({ required_error: "Response deadline is required." }),
  notes: z.string().optional(),
});
type QuotationRequestFormData = z.infer<typeof quotationRequestFormSchema>;


export default function RequisitionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const requisitionId = params.id as string;
  const { toast } = useToast();
  const { appUser, role, currentUser } = useAuth();

  const [requisition, setRequisition] = useState<Requisition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<RequisitionStatus | undefined>(undefined);

  const [isQuoteRequestDialogOpen, setIsQuoteRequestDialogOpen] = useState(false);
  const [isSubmittingQuoteRequest, setIsSubmittingQuoteRequest] = useState(false);
  const [availableSuppliers, setAvailableSuppliers] = useState<Supplier[]>([]);
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);


  const quoteRequestForm = useForm<QuotationRequestFormData>({
    resolver: zodResolver(quotationRequestFormSchema),
    defaultValues: {
      supplierIds: [],
      responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 
      notes: "",
    },
  });


  const fetchRequisitionData = useCallback(async () => {
    if (!requisitionId || !appUser) return;
    setIsLoading(true);
    try {
      const fetchedRequisition = await getRequisitionById(requisitionId);
      if (fetchedRequisition) {
        if (role === 'employee' && fetchedRequisition.requestingUserId !== appUser.uid) {
          toast({ title: "Access Denied", description: "You do not have permission to view this requisition.", variant: "destructive" });
          router.replace("/requisitions");
          return;
        }
        setRequisition(fetchedRequisition);
        setSelectedStatus(fetchedRequisition.status);
      } else {
        toast({ title: "Error", description: "Requisition not found.", variant: "destructive" });
        router.replace("/requisitions");
      }
    } catch (error) {
      console.error("Error fetching requisition details:", error);
      toast({ title: "Error", description: "Failed to fetch requisition details.", variant: "destructive" });
    }
    setIsLoading(false);
  }, [requisitionId, appUser, role, router, toast]);

  useEffect(() => {
    fetchRequisitionData();
  }, [fetchRequisitionData]);

  const handleOpenQuoteRequestDialog = async () => {
    setIsLoadingSuppliers(true);
    try {
      const suppliers = await getAllSuppliers(true); 
      setAvailableSuppliers(suppliers);
      quoteRequestForm.reset({
        supplierIds: [],
        responseDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notes: requisition?.notes || "", 
      });
      setIsQuoteRequestDialogOpen(true);
    } catch (error) {
      toast({ title: "Error", description: "Could not load suppliers for quotation request.", variant: "destructive" });
    }
    setIsLoadingSuppliers(false);
  };

  const handleQuoteRequestSubmit = async (data: QuotationRequestFormData) => {
    if (!requisition || !currentUser) return;
    setIsSubmittingQuoteRequest(true);
    let successCount = 0;
    let errorCount = 0;

    for (const supplierId of data.supplierIds) {
      try {
        const quotationData: CreateQuotationRequestData = {
          requisitionId: requisition.id,
          supplierId: supplierId,
          responseDeadline: Timestamp.fromDate(data.responseDeadline),
          notes: data.notes || "",
        };
        await createQuotation(quotationData, currentUser.uid);
        successCount++;
      } catch (error: any) {
        console.error(`Error creating quotation for supplier ${supplierId}:`, error);
        toast({
          title: `Quotation Request Failed for a supplier`,
          description: error.message || `Could not send request to supplier ${supplierId}.`,
          variant: "destructive",
        });
        errorCount++;
      }
    }
    
    if (successCount > 0) {
      toast({ title: "Quotation Requests Sent", description: `${successCount} quotation request(s) sent successfully.` });
      fetchRequisitionData(); 
    }
    if (errorCount === 0 && successCount > 0) {
      setIsQuoteRequestDialogOpen(false);
    }
    setIsSubmittingQuoteRequest(false);
  };


  const handleStatusUpdate = async () => {
    if (!requisition || !selectedStatus || selectedStatus === requisition.status) {
      toast({title: "No Change", description: "Status is already set to the selected value or no status selected.", variant: "default"});
      return;
    }
    if (role !== 'admin' && role !== 'superadmin') {
      toast({ title: "Permission Denied", description: "You cannot update the status.", variant: "destructive" });
      return;
    }

    setIsUpdatingStatus(true);
    try {
      await updateRequisitionStatus(requisitionId, selectedStatus);
      setRequisition(prev => prev ? { ...prev, status: selectedStatus, updatedAt: Timestamp.now() } : null);
      toast({ title: "Status Updated", description: `Requisition status changed to ${selectedStatus}.` });
    } catch (error) {
      console.error("Error updating requisition status:", error);
      toast({ title: "Update Failed", description: "Could not update requisition status.", variant: "destructive" });
    }
    setIsUpdatingStatus(false);
  };
  
  const formatTimestampDateTime = (timestamp?: Timestamp | null): string => {
    if (!timestamp) return "N/A";
    return timestamp.toDate().toLocaleString();
  };

  const getStatusBadgeVariant = (status: RequisitionStatus) => {
    switch (status) {
      case "Pending Quotation": return "secondary";
      case "Quoted": return "default";
      case "PO in Progress": return "outline";
      case "Completed": return "default";
      case "Canceled": return "destructive";
      default: return "secondary";
    }
  };
   const getStatusBadgeClass = (status: RequisitionStatus) => {
    switch (status) {
      case "Completed": return "bg-green-500 hover:bg-green-600 text-white";
      default: return "";
    }
  };


  if (isLoading && !requisition) { 
    return (
      <div className="space-y-4">
        <PageHeader title="Requisition Details" description="Loading requisition information..." />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!requisition) {
    return (
      <div className="space-y-4">
        <PageHeader title="Requisition Not Found" description="The requested requisition could not be loaded." />
        <Button onClick={() => router.push("/requisitions")} variant="outline">Back to List</Button>
      </div>
    );
  }

  const canManageStatus = role === 'admin' || role === 'superadmin';
  const canRequestQuotes = canManageStatus && (requisition.status === "Pending Quotation" || requisition.status === "Quoted");


  return (
    <>
      <PageHeader
        title={`Requisition: ${requisition.id.substring(0,8)}...`}
        description={`Details for requisition created on ${new Date(requisition.creationDate.seconds * 1000).toLocaleDateString()}`}
        actions={
          <div className="flex gap-2">
            {canRequestQuotes && (
              <Button onClick={handleOpenQuoteRequestDialog} disabled={isLoadingSuppliers}>
                <Icons.Send className="mr-2 h-4 w-4" /> Request Quotations
              </Button>
            )}
            <Button onClick={() => router.back()} variant="outline">Back to List</Button>
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline">Requisition Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Requisition ID:</span><span className="font-medium truncate max-w-[150px]">{requisition.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By:</span><span className="font-medium">{requisition.requestingUserName || requisition.requestingUserId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Creation Date:</span><span className="font-medium">{formatTimestampDateTime(requisition.creationDate)}</span></div>
            <div className="flex justify-between items-center"><span className="text-muted-foreground">Status:</span>
              <Badge variant={getStatusBadgeVariant(requisition.status)} className={getStatusBadgeClass(requisition.status)}>
                {requisition.status}
              </Badge>
            </div>
            <div><span className="text-muted-foreground">Notes:</span><p className="font-medium whitespace-pre-wrap">{requisition.notes || "N/A"}</p></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last Updated:</span><span className="font-medium">{formatTimestampDateTime(requisition.updatedAt)}</span></div>
          </CardContent>
           {canManageStatus && (
            <CardFooter className="border-t pt-4">
                <div className="w-full space-y-2">
                    <Label htmlFor="status-update" className="font-semibold">Update Status:</Label>
                    <div className="flex gap-2">
                    <Select value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as RequisitionStatus)}>
                        <SelectTrigger id="status-update" className="flex-1">
                        <SelectValue placeholder="Select new status" />
                        </SelectTrigger>
                        <SelectContent>
                        {REQUISITION_STATUSES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={handleStatusUpdate} disabled={isUpdatingStatus || selectedStatus === requisition.status}>
                        {isUpdatingStatus ? <Icons.Logo className="animate-spin" /> : "Save Status"}
                    </Button>
                    </div>
                </div>
            </CardFooter>
           )}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-headline">Required Products</CardTitle>
            <CardDescription>List of products requested in this requisition.</CardDescription>
          </CardHeader>
          <CardContent>
            {requisition.requiredProducts && requisition.requiredProducts.length > 0 ? (
               <ScrollArea className="h-[calc(100vh-20rem)]"> 
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Required Qty</TableHead>
                      <TableHead className="text-right">Purchased Qty</TableHead>
                      <TableHead>Item Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisition.requiredProducts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.productName}</TableCell>
                        <TableCell className="text-right">{item.requiredQuantity}</TableCell>
                        <TableCell className="text-right">{item.purchasedQuantity}</TableCell>
                        <TableCell className="whitespace-pre-wrap">{item.notes || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <p>No products listed for this requisition.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isQuoteRequestDialogOpen} onOpenChange={setIsQuoteRequestDialogOpen}>
        <DialogContent className="sm:max-w-lg">
           <Form {...quoteRequestForm}>
            <form onSubmit={quoteRequestForm.handleSubmit(handleQuoteRequestSubmit)}>
              <DialogHeader>
                <DialogTitle className="font-headline">Request Quotations</DialogTitle>
                <DialogDescription>
                  Select suppliers and set a response deadline for requisition: {requisition.id.substring(0,8)}...
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <FormField
                  control={quoteRequestForm.control}
                  name="supplierIds"
                  render={() => (
                    <FormItem>
                      <div className="mb-2">
                        <FormLabel className="text-base font-semibold">Suppliers *</FormLabel>
                        <p className="text-sm text-muted-foreground">Select one or more suppliers to request quotes from.</p>
                      </div>
                      {availableSuppliers.length === 0 && !isLoadingSuppliers ? <p>No active suppliers found.</p> :
                      isLoadingSuppliers && availableSuppliers.length === 0 ? <p>Loading suppliers...</p> :
                      <ScrollArea className="h-40 rounded-md border p-2">
                        {availableSuppliers.map((supplier) => (
                          <FormField
                            key={supplier.id}
                            control={quoteRequestForm.control}
                            name="supplierIds"
                            render={({ field }) => {
                              return (
                                <FormItem key={supplier.id} className="flex flex-row items-center space-x-3 space-y-0 py-1.5">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(supplier.id)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), supplier.id])
                                          : field.onChange((field.value || []).filter((id) => id !== supplier.id));
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal">{supplier.name}</FormLabel>
                                </FormItem>
                              );
                            }}
                          />
                        ))}
                      </ScrollArea> }
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={quoteRequestForm.control}
                  name="responseDeadline"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Response Deadline *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button variant={"outline"} className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                              {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                              <Icons.Calendar className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date < new Date(new Date().setDate(new Date().getDate() -1 )) } initialFocus/>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={quoteRequestForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes to Suppliers (Optional)</FormLabel>
                      <FormControl><Textarea placeholder="Include any general instructions or notes for all selected suppliers." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="submit" disabled={isSubmittingQuoteRequest || isLoadingSuppliers || availableSuppliers.length === 0}>
                  {isSubmittingQuoteRequest ? <Icons.Logo className="animate-spin" /> : <Icons.Send />}
                  {isSubmittingQuoteRequest ? "Sending..." : "Send Requests"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
