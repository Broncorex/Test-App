
"use client";
import { useAuth } from "@/hooks/use-auth-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function RequisitionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, isLoading, appUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && appUser) {
      // Employees, Admins, and Superadmins can access requisitions.
      // Specific creation/update permissions are handled within pages/components.
      const isAllowed = role === 'employee' || role === 'admin' || role === 'superadmin';
      if (!isAllowed) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to access requisitions.",
          variant: "destructive",
        });
        router.replace("/dashboard");
      }
    } else if (!isLoading && !appUser) {
      router.replace("/login");
    }
  }, [role, isLoading, appUser, router, toast]);

  if (isLoading || !appUser) {
    return <div className="flex min-h-screen items-center justify-center"><p>Verifying access to requisitions...</p></div>;
  }

  return <>{children}</>;
}
