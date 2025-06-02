
"use client";
import { useAuth } from "@/hooks/use-auth-store";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, isLoading, appUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && appUser) { // Check appUser to ensure Firestore role is loaded
      const isAllowed = role === 'admin' || role === 'superadmin';
      
      if (!isAllowed) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to access this admin area.",
          variant: "destructive",
        });
        router.replace("/dashboard");
      } else if (pathname === '/admin/users' && role !== 'superadmin') {
        // Specific check for /admin/users, already handled in page, but good for layout too
         toast({
          title: "Access Denied",
          description: "Only superadmins can manage users.",
          variant: "destructive",
        });
        router.replace("/admin/register-user"); // or /dashboard
      }
    } else if (!isLoading && !appUser) {
      // Not authenticated or profile not loaded, redirect
      router.replace("/login");
    }
  }, [role, isLoading, appUser, router, toast, pathname]);

  if (isLoading || !appUser || !(role === 'admin' || role === 'superadmin')) {
    return <div className="flex min-h-screen items-center justify-center"><p>Verifying admin access...</p></div>;
  }

  return <>{children}</>;
}
