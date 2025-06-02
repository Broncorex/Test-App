
"use client";
import { useAuth } from "@/hooks/use-auth-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function SuppliersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, isLoading, appUser } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && appUser) {
      const isAllowed = role === 'admin' || role === 'superadmin';
      if (!isAllowed) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to access supplier management.",
          variant: "destructive",
        });
        router.replace("/dashboard");
      }
    } else if (!isLoading && !appUser) {
      router.replace("/login");
    }
  }, [role, isLoading, appUser, router, toast]);

  if (isLoading || !appUser || !(role === 'admin' || role === 'superadmin')) {
    // Show loading or a generic message, or null if confident redirect will occur fast
    return <div className="flex min-h-screen items-center justify-center"><p>Verifying access to suppliers...</p></div>;
  }

  return <>{children}</>;
}
