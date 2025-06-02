
import { AppShell } from "@/components/layout/app-shell";
// Removed AuthProvider from here

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // <AuthProvider> // Removed
      <AppShell>{children}</AppShell>
    // </AuthProvider> // Removed
  );
}
