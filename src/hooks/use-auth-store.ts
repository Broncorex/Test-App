// src/hooks/use-auth-store.ts
"use client";

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { UserRole } from '@/types';

interface AuthState {
  role: UserRole | null;
  isAuthenticated: boolean;
  login: (role: UserRole, name?: string) => void;
  logout: () => void;
  isLoading: boolean;
  userName: string | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [role, setRole] = useState<UserRole | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    try {
      const storedRole = localStorage.getItem('userRole') as UserRole | null;
      const storedName = localStorage.getItem('userName');
      if (storedRole) {
        setRole(storedRole);
        setUserName(storedName);
        setIsAuthenticated(true);
      } else {
        // If not authenticated and not on a public path, redirect to login
        if (!['/login', '/signup'].includes(pathname)) {
           // router.push('/login'); // Temporarily disable auto-redirect for easier development
        }
      }
    } catch (error) {
      console.warn("Could not access localStorage for auth state.");
    }
    setIsLoading(false);
  }, [pathname, router]);

  const login = useCallback((newRole: UserRole, name: string = "User") => {
    if (newRole) {
      localStorage.setItem('userRole', newRole);
      localStorage.setItem('userName', name);
      setRole(newRole);
      setUserName(name);
      setIsAuthenticated(true);
      router.push('/dashboard');
    }
  }, [router]);

  const logout = useCallback(() => {
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    setRole(null);
    setUserName(null);
    setIsAuthenticated(false);
    router.push('/login');
  }, [router]);

  // If loading, don't render children to prevent flicker or showing content before auth check
  // except for login/signup pages.
  if (isLoading && !['/login', '/signup'].includes(pathname)) {
     return <div className="flex min-h-screen items-center justify-center bg-background"><p>Loading authentication...</p></div>;
  }


  return (
    <AuthContext.Provider value={{ role, isAuthenticated, login, logout, isLoading, userName }}>
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
