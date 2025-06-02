
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icons } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { useAuth } from "@/hooks/use-auth-store.tsx";
import { UserNav } from "./user-nav";
import { TopNavbar } from "./top-navbar";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, appUser } = useAuth();
  const pathname = usePathname();
  const isMobile = useIsMobile(); // isMobile hook is used by TopNavbar internally

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated && !['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
      // Redirect logic is primarily handled by AuthProvider in use-auth-store.tsx
    }
     if (!isLoading && isAuthenticated && !appUser?.isActive && !['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
      // Logic for inactive authenticated users, also handled by AuthProvider
    }
  }, [isLoading, isAuthenticated, appUser, pathname]);

  if (isLoading && !['/login', '/signup', '/forgot-password', '/'].includes(pathname)) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><p>Loading application...</p></div>;
  }

  const isAuthPage = ['/login', '/signup', '/forgot-password'].includes(pathname);

  if (isAuthPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-secondary p-4">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isAuthenticated && (
        <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b bg-secondary px-4 backdrop-blur-md sm:px-6">
          {/* Left: Logo and App Name */}
          <div className="flex items-center flex-shrink-0 mr-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <Icons.Logo className="h-7 w-7 text-primary" />
              <span className="text-lg font-semibold text-foreground hidden sm:inline">
                {APP_NAME}
              </span>
            </Link>
          </div>
          
          {/* Center: Desktop Navigation Menu */}
          {/* This div takes up available space and allows TopNavbar to fill it. */}
          <div className="hidden md:flex flex-1 min-w-0"> {/* Removed items-center */}
            <TopNavbar /> 
          </div>

          {/* Right: UserNav and Mobile Menu Trigger */}
          <div className="flex items-center flex-shrink-0 ml-auto md:ml-4"> 
            <UserNav />
            <div className="md:hidden"> 
              <TopNavbar /> {/* TopNavbar renders Sheet trigger on mobile */}
            </div>
          </div>
        </header>
      )}

      <main className="flex flex-1 flex-col overflow-y-auto p-4 sm:p-6">
        {isAuthenticated ? (
          <div className="mx-auto w-full max-w-7xl flex-1"> 
            {children}
          </div>
        ) : (
          children 
        )}
      </main>
    </div>
  );
}
