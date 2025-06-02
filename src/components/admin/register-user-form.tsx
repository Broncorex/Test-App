
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import * as z from "zod";
import { useState, useEffect } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth-store.tsx";
import { Icons } from "@/components/icons";
import type { UserRole, Warehouse } from "@/types";
import { userRoles as allUserRoles } from "@/lib/constants";
import { getActiveWarehouses } from "@/services/warehouseService";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";


const formSchemaBase = z.object({
  displayName: z.string().min(2, { message: "Display name must be at least 2 characters." }).optional().or(z.literal('')),
  email: z.string().email({ message: "Invalid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
  confirmPassword: z.string().min(6, { message: "Password must be at least 6 characters." }),
  roleToAssign: z.custom<UserRole>((val) => allUserRoles.includes(val as UserRole), {
    message: "Invalid role selected.",
  }),
  assignedWarehouseIds: z.array(z.string()).optional(), // Changed to array
});

const formSchema = formSchemaBase.refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
}).refine(data => {
  if (data.roleToAssign === 'employee') {
    return true; 
  }
  // If not employee, assignedWarehouseIds should be empty or undefined
  return !data.assignedWarehouseIds || data.assignedWarehouseIds.length === 0;
}, {
  message: "Warehouses can only be assigned to employees.",
  path: ["assignedWarehouseIds"],
});

interface CreateNewUserDataClientPayload {
  email: string;
  password?: string;
  displayName?: string;
  roleToAssign: "employee" | "admin" | "superadmin";
  assignedWarehouseIds?: string[];
}


export function RegisterUserForm() {
  const { registerUserByAdmin, role: currentAdminRole, currentUser } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(true);

  useEffect(() => {
    async function loadWarehouses() {
      setIsLoadingWarehouses(true);
      try {
        const activeWarehouses = await getActiveWarehouses();
        setWarehouses(activeWarehouses);
      } catch (error) {
        console.error("Failed to load warehouses for assignment", error);
        toast({ title: "Error", description: "Could not load warehouses for assignment.", variant: "destructive"});
      }
      setIsLoadingWarehouses(false);
    }
    loadWarehouses();
  }, [toast]);

  const availableRolesForSuperAdmin = allUserRoles;
  const availableRolesForAdmin = allUserRoles.filter(r => r === 'employee');

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: "",
      email: "",
      password: "",
      confirmPassword: "",
      roleToAssign: currentAdminRole === 'superadmin' ? "employee" : "employee",
      assignedWarehouseIds: [], 
    },
  });

  const watchRoleToAssign = form.watch("roleToAssign");

  useEffect(() => {
    if (watchRoleToAssign !== 'employee') {
      form.setValue('assignedWarehouseIds', []);
    }
  }, [watchRoleToAssign, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    if (!currentUser?.uid) {
        form.setError("root", { message: "Current admin user not found."});
        setIsSubmitting(false);
        return;
    }

    let roleToActuallyAssign = values.roleToAssign;
    if (currentAdminRole === 'admin') {
        roleToActuallyAssign = 'employee';
    }

    const payload: CreateNewUserDataClientPayload = {
      email: values.email,
      password: values.password,
      displayName: values.displayName || values.email.split('@')[0],
      roleToAssign: roleToActuallyAssign,
    };

    if (roleToActuallyAssign === 'employee' && values.assignedWarehouseIds && values.assignedWarehouseIds.length > 0) {
      payload.assignedWarehouseIds = values.assignedWarehouseIds;
    }

    const result = await registerUserByAdmin(payload);

    if (result.success) {
        form.reset({
            displayName: "",
            email: "",
            password: "",
            confirmPassword: "",
            roleToAssign: currentAdminRole === 'superadmin' ? "employee" : "employee",
            assignedWarehouseIds: [],
        });
    } else if (result.message) {
        form.setError("root", { message: result.message });
    }
    setIsSubmitting(false);
  }

  return (
    <Card className="w-full max-w-lg shadow-lg">
      <CardHeader>
        <CardTitle className="font-headline">New User Details</CardTitle>
        <CardDescription>Fill in the form to create a new user account.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="user@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="roleToAssign"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assign Role</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                    }}
                    value={field.value} 
                    disabled={currentAdminRole === 'admin'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(currentAdminRole === 'superadmin' ? availableRolesForSuperAdmin : availableRolesForAdmin).map((r) => (
                        <SelectItem key={r} value={r}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </SelectItem>
                      ))}
                        {currentAdminRole === 'superadmin' && field.value === 'superadmin' && (
                           <p className="px-2 py-1.5 text-xs text-destructive">Creating another Superadmin.</p>
                        )}
                    </SelectContent>
                  </Select>
                   {currentAdminRole === 'admin' && <p className="text-sm text-muted-foreground">Admins can only register new users as 'Employee'.</p>}
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchRoleToAssign === 'employee' && (
              <FormField
                control={form.control}
                name="assignedWarehouseIds"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base">Assign Warehouses (Optional for Employee)</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Select one or more warehouses for this employee.
                      </p>
                    </div>
                    {isLoadingWarehouses ? <p>Loading warehouses...</p> :
                    warehouses.length === 0 ? <p>No active warehouses available.</p> :
                    <ScrollArea className="h-40 rounded-md border p-2">
                      {warehouses.map((warehouse) => (
                        <FormField
                          key={warehouse.id}
                          control={form.control}
                          name="assignedWarehouseIds"
                          render={({ field }) => {
                            return (
                              <FormItem
                                key={warehouse.id}
                                className="flex flex-row items-start space-x-3 space-y-0 py-2"
                              >
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(warehouse.id)}
                                    onCheckedChange={(checked) => {
                                      return checked
                                        ? field.onChange([...(field.value || []), warehouse.id])
                                        : field.onChange(
                                            (field.value || []).filter(
                                              (value) => value !== warehouse.id
                                            )
                                          );
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal">
                                  {warehouse.name}
                                </FormLabel>
                              </FormItem>
                            );
                          }}
                        />
                      ))}
                    </ScrollArea>}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

             {form.formState.errors.root && <p className="text-sm font-medium text-destructive">{form.formState.errors.root.message}</p>}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting || isLoadingWarehouses}>
              {isSubmitting ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.UserPlus className="mr-2 h-4 w-4" />}
              {isSubmitting ? "Registering..." : "Register User"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
