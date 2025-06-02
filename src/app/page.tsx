
// src/app/page.tsx
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation'; 
import { useAuth } from '@/hooks/use-auth-store'; // AuthProvider removed from here
import { Skeleton } from '@/components/ui/skeleton';


function HomePageContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [isAuthenticated, isLoading, router]);

  // Render a loading skeleton or message while checking auth and redirecting
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <Skeleton className="h-12 w-12 rounded-full mb-4" />
      <Skeleton className="h-8 w-48 mb-2" />
      <Skeleton className="h-4 w-64" />
      <p className="mt-4 text-sm text-muted-foreground">Loading StockPilot...</p>
    </div>
  );
}

export default function HomePage() {
  return (
    // <AuthProvider> // Removed
      <HomePageContent />
    // </AuthProvider> // Removed
  );
}
