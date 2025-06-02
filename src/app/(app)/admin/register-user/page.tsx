
"use client";

import { RegisterUserForm } from "@/components/admin/register-user-form";
import { PageHeader } from "@/components/shared/page-header";
import { useAuth } from "@/hooks/use-auth-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RegisterUserPage() {
  const { role, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !(role === 'admin' || role === 'superadmin')) {
      router.replace('/dashboard'); // Or show access denied
    }
  }, [role, isLoading, router]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>;
  }

  if (!(role === 'admin' || role === 'superadmin')) {
    return <div className="flex min-h-screen items-center justify-center"><p>Access Denied.</p></div>;
  }

  return (
    <>
      <PageHeader
        title="Register New User"
        description="Create a new user account for the system."
      />
      <div className="flex w-full justify-center">
        <RegisterUserForm />
      </div>
    </>
  );
}
