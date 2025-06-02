
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { User, UserRole, Warehouse } from "@/types";
import { useAuth, type UpdateUserProfileData } from "@/hooks/use-auth-store.tsx";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { userRoles } from "@/lib/constants";
import { collection, getDocs, doc, query, orderBy, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getActiveWarehouses } from "@/services/warehouseService";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormField, FormItem, FormControl, FormLabel as ShadFormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";


const editUserFormSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters.").optional().or(z.literal('')),
  // assignedWarehouseIds is now handled by the popover for employees
});

type EditUserFormData = z.infer<typeof editUserFormSchema>;


export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState<UserRole | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("active");

  const [isEditUserDialogOpen, setIsEditUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // For Warehouse Assignment Popover
  const [popoverTargetUser, setPopoverTargetUser] = useState<User | null>(null);
  const [selectedWarehouseIdsInPopover, setSelectedWarehouseIdsInPopover] = useState<string[]>([]);
  const [isWarehousePopoverOpen, setIsWarehousePopoverOpen] = useState(false);


  const { toast } = useToast();
  const {
    role: currentAdminRole,
    appUser: currentAdminUser,
    updateUserRoleInFirestore,
    toggleUserActiveStatusInFirestore,
    sendUserPasswordResetEmail,
    updateUserProfileInFirestore,
    isLoading: authIsLoading
  } = useAuth();
  const router = useRouter();

  const editForm = useForm<EditUserFormData>({
    resolver: zodResolver(editUserFormSchema),
    defaultValues: {
      displayName: "",
    },
  });

  const getWarehouseNamesByIds = useCallback((warehouseIds: string[] | undefined): string => {
    if (!warehouseIds || warehouseIds.length === 0) return "N/A";
    return warehouseIds
        .map(id => warehouses.find(wh => wh.id === id)?.name || "Unknown")
        .join(", ");
  }, [warehouses]);


  const fetchInitialData = useCallback(async () => {
    if (!currentAdminUser || !currentAdminRole) return;
    if (currentAdminRole !== 'superadmin' && currentAdminRole !== 'admin') {
        router.replace('/dashboard');
        return;
    }

    setIsLoadingPage(true);
    try {
      const activeWarehouses = await getActiveWarehouses();
      setWarehouses(activeWarehouses);

      let usersQuery = query(collection(db, "users"), orderBy("createdAt", "desc"));

      if (currentAdminRole === 'admin') {
        usersQuery = query(usersQuery, where("role", "==", "employee"));
      }

      const querySnapshot = await getDocs(usersQuery);
      const usersList: User[] = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        // Normalize assignedWarehouseIds
        let normalizedAssignedWarehouseIds: string[] | undefined = undefined;
        if (data.assignedWarehouseIds) {
            if (typeof data.assignedWarehouseIds === 'string') {
                normalizedAssignedWarehouseIds = [data.assignedWarehouseIds];
            } else if (Array.isArray(data.assignedWarehouseIds)) {
                normalizedAssignedWarehouseIds = data.assignedWarehouseIds;
            }
        }
        return {
            id: docSnap.id,
            ...data,
            assignedWarehouseIds: normalizedAssignedWarehouseIds,
            createdAt: (data.createdAt as any)?.toDate ? (data.createdAt as any).toDate() : new Date(),
        } as User;
      });
      setUsers(usersList);
    } catch (error) {
      console.error("Error fetching users or warehouses:", error);
      toast({ title: "Error", description: "Failed to fetch initial data.", variant: "destructive" });
    }
    setIsLoadingPage(false);
  }, [currentAdminRole, currentAdminUser, toast, router]);

  useEffect(() => {
    if (authIsLoading) return;

    if (!currentAdminRole || (currentAdminRole !== 'superadmin' && currentAdminRole !== 'admin')) {
      toast({ title: "Access Denied", description: "You do not have permission to view this page.", variant: "destructive" });
      router.replace('/dashboard');
      return;
    }
    fetchInitialData();
  }, [currentAdminRole, authIsLoading, router, toast, fetchInitialData]);


  const handleOpenEditDialog = (user: User) => {
    setEditingUser(user);
    editForm.reset({
        displayName: user.displayName || "",
    });
    setIsEditUserDialogOpen(true);
  };

  const handleEditUserSubmit = async (data: EditUserFormData) => {
    if (!editingUser || !currentAdminUser || currentAdminRole !== 'superadmin') {
        toast({ title: "Error", description: "Cannot edit user.", variant: "destructive"});
        return;
    }
    setIsSubmittingEdit(true);
    const payload: UpdateUserProfileData = {};

    if (data.displayName && data.displayName !== editingUser.displayName) {
        payload.displayName = data.displayName || editingUser.email?.split('@')[0] || 'User';
    } else if (data.displayName === "" && editingUser.displayName) { // Handle clearing the display name
        payload.displayName = editingUser.email?.split('@')[0] || 'User'; // Revert to default if cleared
    }
    
    if (Object.keys(payload).length > 0) {
        const result = await updateUserProfileInFirestore(editingUser.id, payload);
        if (result.success) {
            toast({ title: "User Updated", description: "User details have been updated."});
            fetchInitialData();
            setIsEditUserDialogOpen(false);
        } else {
            // Error already toasted by updateUserProfileInFirestore
        }
    } else {
        toast({ title: "No Changes", description: "No changes were made to the user details."});
        setIsEditUserDialogOpen(false);
    }
    setIsSubmittingEdit(false);
  };


  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const result = await updateUserRoleInFirestore(userId, newRole);
    if (result.success) {
      fetchInitialData();
    }
  };

  const handleToggleActive = async (userId: string, currentIsActive: boolean) => {
    const result = await toggleUserActiveStatusInFirestore(userId, currentIsActive);
     if (result.success) {
      fetchInitialData();
    }
  };

  const handlePasswordReset = async (email: string | null) => {
    if (!email) {
        toast({title: "Error", description: "User email is not available.", variant: "destructive"});
        return;
    }
    await sendUserPasswordResetEmail(email);
  }

  const handleOpenWarehousePopover = (user: User) => {
    setPopoverTargetUser(user);
    setSelectedWarehouseIdsInPopover(user.assignedWarehouseIds || []);
    setIsWarehousePopoverOpen(true);
  };

  const handleSaveWarehouseAssignments = async () => {
    if (!popoverTargetUser || currentAdminRole !== 'superadmin') {
      toast({ title: "Error", description: "Cannot update warehouse assignments.", variant: "destructive" });
      return;
    }
    setIsSubmittingEdit(true); 
    const payload: UpdateUserProfileData = {
      assignedWarehouseIds: selectedWarehouseIdsInPopover.length > 0 ? selectedWarehouseIdsInPopover : null, 
    };

    const result = await updateUserProfileInFirestore(popoverTargetUser.id, payload);
    if (result.success) {
      toast({ title: "Warehouse Assignments Updated", description: "Assignments have been saved." });
      fetchInitialData();
      setIsWarehousePopoverOpen(false);
      setPopoverTargetUser(null);
    } else {
      // Error handled by updateUserProfileInFirestore
    }
    setIsSubmittingEdit(false);
  };

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = searchTerm === "" ||
                            user.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            user.email?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRole = filterRole === "all" || user.role === filterRole;
      const matchesStatus = filterStatus === "all" || (filterStatus === "active" && user.isActive) || (filterStatus === "inactive" && !user.isActive);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, filterRole, filterStatus]);


  if (authIsLoading || (isLoadingPage && !users.length)) {
     return <div className="flex min-h-screen items-center justify-center"><p>Loading user data...</p></div>;
  }
  if (!currentAdminRole || (currentAdminRole !== 'superadmin' && currentAdminRole !== 'admin')) {
    return null;
  }

  const canManageRole = (targetUserRole: UserRole) => {
    if (currentAdminRole === 'superadmin') return targetUserRole !== 'superadmin'; 
    return false;
  }

  const canToggleActive = (targetUserId: string, targetUserRole: UserRole) => {
    if (currentAdminUser?.id === targetUserId) return false;
    if (currentAdminRole === 'superadmin') {
      return true;
    }
    if (currentAdminRole === 'admin') {
      return targetUserRole === 'employee';
    }
    return false;
  }
 
  const canEditUserDetails = (targetUser: User) => {
    return currentAdminRole === 'superadmin';
  }

  const canManageWarehousesForUser = (targetUser: User) => {
    return currentAdminRole === 'superadmin' && targetUser.role === 'employee';
  }


  return (
    <>
      <PageHeader
        title="User Management"
        description="Manage user accounts and roles within the system."
        actions={
          (currentAdminRole === 'admin' || currentAdminRole === 'superadmin') && (
            <Button onClick={() => router.push('/admin/register-user')}>
              <Icons.UserPlus className="mr-2 h-4 w-4" /> Add New User
            </Button>
          )
        }
      />
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">User Accounts</CardTitle>
           <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="md:col-span-1"
            />
            {currentAdminRole === 'superadmin' && (
              <Select value={filterRole} onValueChange={(value) => setFilterRole(value as UserRole | "all")}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {userRoles.filter(r => r !== 'superadmin').map(r => <SelectItem key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</SelectItem>)}
                  <SelectItem value="superadmin">Superadmin</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as "all" | "active" | "inactive")}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned Warehouses</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingPage ? (
                Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={`skeleton-user-${idx}`}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.displayName || user.name || "N/A"}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(newRole) => handleRoleChange(user.id, newRole as UserRole)}
                      disabled={user.id === currentAdminUser?.id || !canManageRole(user.role) || authIsLoading}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {userRoles.filter(r => r !== 'superadmin').map(r => (
                          <SelectItem key={r} value={r} disabled={currentAdminRole !== 'superadmin' && r !== 'employee'}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </SelectItem>
                        ))}
                         {user.role === 'superadmin' && <SelectItem value="superadmin" disabled>Superadmin</SelectItem>}
                         {/* Removed redundant Admin option: {currentAdminRole === 'superadmin' && <SelectItem value="admin">Admin</SelectItem>} */}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.role === 'employee' ? (
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[150px]">{getWarehouseNamesByIds(user.assignedWarehouseIds)}</span>
                        {canManageWarehousesForUser(user) && (
                          <Popover open={isWarehousePopoverOpen && popoverTargetUser?.id === user.id} onOpenChange={(isOpen) => {
                            if (!isOpen) {
                                setIsWarehousePopoverOpen(false);
                                setPopoverTargetUser(null);
                            } else {
                                handleOpenWarehousePopover(user);
                            }
                          }}>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenWarehousePopover(user)}>
                                <Icons.Edit className="h-3 w-3" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0" align="start">
                              <div className="p-4">
                                <Label className="text-base font-medium">Manage Warehouses for {user.displayName}</Label>
                                <p className="text-sm text-muted-foreground mb-2">Select warehouses for this employee.</p>
                                {isLoadingPage || warehouses.length === 0 ? (
                                  <p>{isLoadingPage ? "Loading..." : "No active warehouses."}</p>
                                ) : (
                                  <ScrollArea className="h-40 rounded-md border p-2">
                                    {warehouses.map((warehouse) => (
                                      <div key={warehouse.id} className="flex flex-row items-center space-x-3 space-y-0 py-2">
                                        <Checkbox
                                          id={`wh-${user.id}-${warehouse.id}`}
                                          checked={selectedWarehouseIdsInPopover.includes(warehouse.id)}
                                          onCheckedChange={(checked) => {
                                            setSelectedWarehouseIdsInPopover(prev =>
                                              checked
                                                ? [...prev, warehouse.id]
                                                : prev.filter(id => id !== warehouse.id)
                                            );
                                          }}
                                        />
                                        <Label htmlFor={`wh-${user.id}-${warehouse.id}`} className="font-normal">
                                          {warehouse.name}
                                        </Label>
                                      </div>
                                    ))}
                                  </ScrollArea>
                                )}
                                <DialogFooter className="pt-4 gap-2">
                                  <Button type="button" variant="outline" size="sm" onClick={() => { setIsWarehousePopoverOpen(false); setPopoverTargetUser(null);}}>Cancel</Button>
                                  <Button type="button" size="sm" onClick={handleSaveWarehouseAssignments} disabled={isSubmittingEdit || authIsLoading}>
                                    {isSubmittingEdit ? <Icons.Logo className="animate-spin" /> : "Save"}
                                  </Button>
                                </DialogFooter>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    ) : 'N/A'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "destructive"} className={user.isActive ? "bg-green-500 text-white hover:bg-green-600" : "hover:bg-red-700"}>
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                   <TableCell>{user.createdAt ? new Date(user.createdAt as any).toLocaleDateString() : 'N/A'}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {canEditUserDetails(user) && (
                        <Button variant="outline" size="sm" onClick={() => handleOpenEditDialog(user)} disabled={authIsLoading}>
                            <Icons.Edit className="mr-1 h-4 w-4" /> Edit Name
                        </Button>
                    )}
                     <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant={user.isActive ? "destructive" : "secondary"}
                          size="sm"
                          disabled={!canToggleActive(user.id, user.role) || authIsLoading}
                        >
                          {user.isActive ? <Icons.Delete className="mr-1 h-4 w-4" /> : <Icons.Package className="mr-1 h-4 w-4"/>}
                          {user.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action will {user.isActive ? "deactivate" : "activate"} the user account for {user.displayName || user.email}.
                            {user.isActive ? " Deactivated users cannot log in." : " Activated users will be able to log in."}
                            {user.isActive && user.role === 'superadmin' && user.id !== currentAdminUser?.id && <span className="font-bold text-destructive"> Deactivating another Superadmin will prevent them from accessing the system.</span>}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleToggleActive(user.id, user.isActive)}>
                            Confirm {user.isActive ? "Deactivation" : "Activation"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button variant="outline" size="sm" onClick={() => handlePasswordReset(user.email)} disabled={authIsLoading}>
                        <Icons.Send className="mr-1 h-4 w-4" /> Reset Pass
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
           { !isLoadingPage && filteredUsers.length === 0 && (
             <div className="text-center py-8 text-muted-foreground">
                {users.length === 0 ? "No users found in the system." : "No users match your current filters."}
            </div>
           )}
        </CardContent>
      </Card>

      <Dialog open={isEditUserDialogOpen} onOpenChange={setIsEditUserDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User: {editingUser?.displayName || editingUser?.email}</DialogTitle>
            <DialogDescription>
              Modify the user's display name. Only superadmins can perform these changes.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditUserSubmit)} className="space-y-4">
                <FormField
                    control={editForm.control}
                    name="displayName"
                    render={({ field }) => (
                        <FormItem>
                        <ShadFormLabel>Display Name</ShadFormLabel>
                        <FormControl>
                            <Input placeholder="Enter display name" {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                 {editForm.formState.errors.root && (
                    <p className="text-sm font-medium text-destructive">{editForm.formState.errors.root.message}</p>
                )}
              <DialogFooter className="pt-4">
                <DialogClose asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmittingEdit || authIsLoading}>
                  {isSubmittingEdit ? <Icons.Logo className="animate-spin" /> : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

    

    