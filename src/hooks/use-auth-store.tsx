
"use client";

import type { User as FirebaseUser } from 'firebase/auth';
import {
  onAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { getFunctions, httpsCallable, type HttpsCallable } from 'firebase/functions';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { useRouter, usePathname } from 'next/navigation';
import type React from 'react';
import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';

import { auth, db } from '@/lib/firebase';
import type { UserRole, User as AppUser } from '@/types';
import { useToast } from './use-toast';

interface CreateNewUserDataClientPayload {
  email: string;
  password?: string;
  displayName?: string;
  roleToAssign: "employee" | "admin" | "superadmin";
  assignedWarehouseIds?: string[];
}

export interface UpdateUserProfileData {
  displayName?: string;
  assignedWarehouseIds?: string[] | null; // Array of IDs or null to clear
}


interface AuthState {
  currentUser: FirebaseUser | null;
  appUser: AppUser | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  login: (email_: string, password_: string) => Promise<void>;
  registerUserByAdmin: (
    payload: CreateNewUserDataClientPayload
  ) => Promise<{ success: boolean; message?: string }>;
  sendPasswordReset: (email_: string) => Promise<void>;
  sendUserPasswordResetEmail: (email: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  isLoading: boolean;
  userName: string | null;
  updateUserRoleInFirestore: (targetUserId: string, newRole: UserRole) => Promise<{ success: boolean; message?: string }>;
  toggleUserActiveStatusInFirestore: (targetUserId: string, currentIsActive: boolean) => Promise<{ success: boolean; message?: string }>;
  updateUserProfileInFirestore: (userId: string, data: UpdateUserProfileData) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  const clearAuthState = useCallback(() => {
    setCurrentUser(null);
    setAppUser(null);
    setRole(null);
    setUserName(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setIsLoading(true);
      if (user) {
        const userDocRef = doc(db, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data() as AppUser;
          
          // Normalize assignedWarehouseIds:
          // If it's a string (old format), convert to array.
          // The type assertion `as any` is used because Firestore might return it as string
          // before we've fully migrated.
          let normalizedAssignedWarehouseIds: string[] | undefined = undefined;
          if (userData.assignedWarehouseIds) {
            if (typeof (userData.assignedWarehouseIds as any) === 'string') {
              normalizedAssignedWarehouseIds = [(userData.assignedWarehouseIds as any as string)];
            } else if (Array.isArray(userData.assignedWarehouseIds)) {
              normalizedAssignedWarehouseIds = userData.assignedWarehouseIds;
            }
          }
          
          const processedUserData: AppUser = {
            ...userData,
            assignedWarehouseIds: normalizedAssignedWarehouseIds,
          };


          if (!processedUserData.isActive) {
            await signOut(auth);
            toast({ title: "Account Disabled", description: "Your account is currently inactive. Please contact an administrator.", variant: "destructive" });
            // Redirect will be handled by the subsequent onAuthStateChanged(null)
          } else {
            setCurrentUser(user);
            setAppUser(processedUserData);
            setRole(processedUserData.role);
            setUserName(processedUserData.displayName || user.displayName || "User");

            if (['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
              router.push('/dashboard');
            }
          }
        } else {
          await signOut(auth);
          toast({ title: "Profile Error", description: "User profile not found. Please contact support.", variant: "destructive" });
        }
      } else {
        clearAuthState();
        if (!['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
          router.push('/login');
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [pathname, router, toast, clearAuthState]);

  const login = useCallback(
    async (email_: string, password_: string) => {
      setIsLoading(true);
      try {
        await signInWithEmailAndPassword(auth, email_, password_);
      } catch (error: any) {
        console.error("Login error:", error);
        toast({ title: "Login Failed", description: error.message || "Invalid credentials or account issue.", variant: "destructive" });
        setIsLoading(false);
      }
    },
    [toast]
  );

  const registerUserByAdmin = useCallback(
    async (payload: CreateNewUserDataClientPayload): Promise<{ success: boolean; message?: string }> => {
      if (!currentUser || !appUser) {
        toast({title: "Admin Error", description: "Admin session not found or admin profile not loaded.", variant: "destructive"})
        return { success: false, message: "Admin session not found or admin profile not loaded." };
      }

      if (appUser.role === 'admin' && payload.roleToAssign !== 'employee') {
        toast({title: "Permission Denied", description: "Admins can only register new users as 'employee'.", variant: "destructive"})
        return { success: false, message: "Admins can only register new users as 'employee'." };
      }
      if (payload.roleToAssign !== 'employee' && payload.assignedWarehouseIds && payload.assignedWarehouseIds.length > 0) {
        toast({title: "Invalid Input", description: "Warehouses can only be assigned to employees.", variant: "destructive"})
        return { success: false, message: "Warehouses can only be assigned to employees."};
      }


      try {
        const functions = getFunctions(auth.app);
        const createNewUserCallable: HttpsCallable<CreateNewUserDataClientPayload, { success: boolean; message?: string; uid?: string }> = httpsCallable(functions, 'createNewUserByAdmin');

        const result = await createNewUserCallable(payload);

        if (result.data.success) {
          toast({ title: "User Registered", description: result.data.message || `${payload.displayName || payload.email} has been registered as ${payload.roleToAssign}.` });
          return { success: true };
        } else {
          throw new Error(result.data.message || "Cloud function indicated failure to create user.");
        }
      } catch (error: any) {
        console.error("Admin User Registration error via Cloud Function:", error);
        let message = "Could not register user via Cloud Function.";
        if (error.message) {
          message = error.message;
        } else if (error.details && error.details.message) {
            message = error.details.message;
        }
        toast({ title: "Registration Failed", description: message, variant: "destructive" });
        return { success: false, message };
      }
    },
    [toast, currentUser, appUser]
  );

  const sendPasswordReset = useCallback(
    async (email_: string) => {
      setIsLoading(true);
      try {
        await firebaseSendPasswordResetEmail(auth, email_);
        toast({ title: "Password Reset Email Sent", description: "Check your email for a link to reset your password." });
      } catch (error: any) {
        console.error("Password reset error:", error);
        toast({ title: "Password Reset Failed", description: error.message || "Could not send reset email.", variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    },
    [toast]
  );

  const sendUserPasswordResetEmail = useCallback(
    async (email: string): Promise<{ success: boolean; message?: string }> => {
      if (!role || (role !== 'admin' && role !== 'superadmin')) {
         toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive" });
        return { success: false, message: "Permission denied." };
      }
      try {
        await firebaseSendPasswordResetEmail(auth, email);
        toast({ title: "Password Reset Email Sent", description: `A password reset email has been sent to ${email}.` });
        return { success: true };
      } catch (error: any) {
        console.error("Error sending password reset email:", error);
        toast({ title: "Error", description: error.message || "Failed to send password reset email.", variant: "destructive" });
        return { success: false, message: error.message || "Failed to send password reset email." };
      }
    },
    [toast, role]
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await signOut(auth);
      toast({ title: "Logged Out", description: "You have been successfully logged out."});
    } catch (error: any) {
       console.error("Logout error:", error);
       toast({ title: "Logout Failed", description: error.message || "Could not log out.", variant: "destructive" });
       setIsLoading(false);
    }
  }, [toast]);

  const updateUserRoleInFirestore = useCallback(
    async (targetUserId: string, newRole: UserRole): Promise<{ success: boolean; message?: string }> => {
      if (role !== 'superadmin' || !currentUser) {
         toast({ title: "Permission Denied", description: "Only superadmins can change roles.", variant: "destructive" });
        return { success: false, message: "Permission denied." };
      }
      if (targetUserId === currentUser.uid) {
         toast({ title: "Action Denied", description: "Superadmins cannot change their own role here.", variant: "destructive" });
        return { success: false, message: "Superadmins cannot change their own role." };
      }

      const targetUserDocRef = doc(db, "users", targetUserId);
      const targetUserSnap = await getDoc(targetUserDocRef);
      if (!targetUserSnap.exists()) {
        toast({ title: "Error", description: "Target user not found.", variant: "destructive" });
        return { success: false, message: "Target user not found." };
      }
      const targetUserData = targetUserSnap.data() as AppUser;

      if (targetUserData.role === 'superadmin') {
         toast({ title: "Action Denied", description: "Cannot change the role of another superadmin via this interface.", variant: "destructive" });
         return { success: false, message: "Cannot demote another superadmin through this interface."};
      }
       if (newRole === 'superadmin') {
        toast({ title: "Confirm Promotion", description: `You are promoting user ${targetUserData.displayName || targetUserData.email} to Superadmin. Proceed with caution.`, variant: "default" });
      }

      try {
        const updatePayload: { role: UserRole, assignedWarehouseIds?: any } = { role: newRole };
        if (targetUserData.role === 'employee' && (newRole === 'admin' || newRole === 'superadmin')) {
          updatePayload.assignedWarehouseIds = deleteField(); 
        }
        await updateDoc(targetUserDocRef, updatePayload);
        toast({ title: "Role Updated", description: `User's role changed to ${newRole}.` });
        return { success: true };
      } catch (error: any) {
        console.error("Error updating role:", error);
        toast({ title: "Update Failed", description: "Could not update user role.", variant: "destructive" });
        return { success: false, message: error.message };
      }
    },
    [role, currentUser, toast]
  );

  const toggleUserActiveStatusInFirestore = useCallback(
    async (targetUserId: string, currentIsActive: boolean): Promise<{ success: boolean; message?: string }> => {
      if (!role || !currentUser || (role !== 'admin' && role !== 'superadmin')) {
        toast({ title: "Permission Denied", description: "You cannot perform this action.", variant: "destructive" });
        return { success: false, message: "Permission denied." };
      }
       if (targetUserId === currentUser.uid && currentIsActive) { 
        toast({ title: "Action Denied", description: "You cannot deactivate your own account.", variant: "destructive" });
        return { success: false, message: "Cannot deactivate own account." };
      }

      const targetUserDocRef = doc(db, "users", targetUserId);
      const targetUserSnap = await getDoc(targetUserDocRef);
      if (!targetUserSnap.exists()) {
         toast({ title: "Error", description: "Target user not found.", variant: "destructive" });
        return { success: false, message: "Target user not found." };
      }
      const targetUserData = targetUserSnap.data() as AppUser;

      if (role === 'admin' && targetUserData.role !== 'employee') {
        toast({ title: "Permission Denied", description: "Admins can only manage employee accounts.", variant: "destructive" });
        return { success: false, message: "Admins can only manage employee accounts." };
      }
      if (role === 'superadmin' && targetUserData.role === 'superadmin' && targetUserId === currentUser.uid && currentIsActive) {
         toast({ title: "Action Denied", description: "You cannot deactivate your own superadmin account.", variant: "destructive" });
         return { success: false, message: "Cannot deactivate own superadmin account."};
      }


      try {
        await updateDoc(targetUserDocRef, { isActive: !currentIsActive });
        toast({ title: `User ${!currentIsActive ? "Activated" : "Deactivated"}`, description: `User account has been ${!currentIsActive ? "activated" : "deactivated"}.` });
        return { success: true };
      } catch (error: any)
      {
        console.error("Error toggling active status:", error);
        toast({ title: "Update Failed", description: "Could not update user status.", variant: "destructive" });
        return { success: false, message: error.message };
      }
    },
    [role, currentUser, toast]
  );

  const updateUserProfileInFirestore = useCallback(
    async (userId: string, data: UpdateUserProfileData): Promise<{ success: boolean; message?: string }> => {
      if (role !== 'superadmin' || !currentUser) {
        toast({ title: "Permission Denied", description: "Only superadmins can update user profiles.", variant: "destructive" });
        return { success: false, message: "Permission denied." };
      }

      const userDocRef = doc(db, "users", userId);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        toast({ title: "Error", description: "User not found.", variant: "destructive" });
        return { success: false, message: "User not found." };
      }
      
      const targetUserData = userDocSnap.data() as AppUser;
      const updatePayload: Partial<AppUser & { assignedWarehouseIds?: any}> = {};


      if (data.displayName !== undefined && data.displayName !== targetUserData.displayName) {
        updatePayload.displayName = data.displayName || targetUserData.email?.split('@')[0] || 'User';
        if (auth.currentUser && userId === auth.currentUser.uid) {
            await updateFirebaseProfile(auth.currentUser, { displayName: updatePayload.displayName });
        } else {
            logger.info("Superadmin changed display name for another user. Firebase Auth profile not updated from client.");
        }
      }

      if (targetUserData.role === 'employee') {
        if (data.assignedWarehouseIds !== undefined) { // Check if assignedWarehouseIds is part of the update
          // If null or empty array is passed, delete the field, otherwise set the array
          updatePayload.assignedWarehouseIds = (data.assignedWarehouseIds === null || data.assignedWarehouseIds.length === 0) ? deleteField() : data.assignedWarehouseIds;
        }
      } else {
        // If user is not employee, ensure warehouse assignments are cleared
        // Only clear if 'assignedWarehouseIds' was explicitly part of the 'data' to change, or if they had it before
        if (data.assignedWarehouseIds !== undefined || targetUserData.assignedWarehouseIds) {
            updatePayload.assignedWarehouseIds = deleteField();
            if (data.assignedWarehouseIds && data.assignedWarehouseIds.length > 0) {
                toast({ title: "Warning", description: "Warehouse assignment is only for employees. It has been cleared for this user.", variant: "default" });
            }
        }
      }
      
      if (Object.keys(updatePayload).length === 0) {
        toast({ title: "No Changes", description: "No information was provided to update.", variant: "default" });
        return { success: true, message: "No changes provided." };
      }

      try {
        await updateDoc(userDocRef, updatePayload);
        toast({ title: "Profile Updated", description: `User profile for ${targetUserData.displayName || targetUserData.email} has been updated.` });
        return { success: true };
      } catch (error: any) {
        console.error("Error updating user profile:", error);
        toast({ title: "Update Failed", description: "Could not update user profile.", variant: "destructive" });
        return { success: false, message: error.message };
      }
    },
    [role, currentUser, toast]
  );

  const isAuthenticated = !!currentUser && !!appUser && appUser.isActive;

  if (isLoading && !['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><p>Loading authentication...</p></div>;
  }

  return (
    <AuthContext.Provider value={{
        currentUser,
        appUser,
        role,
        isAuthenticated,
        login,
        registerUserByAdmin,
        sendPasswordReset,
        sendUserPasswordResetEmail,
        logout,
        isLoading,
        userName,
        updateUserRoleInFirestore,
        toggleUserActiveStatusInFirestore,
        updateUserProfileInFirestore
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const logger = {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
};


    