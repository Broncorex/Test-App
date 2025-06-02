
// Removed AuthProvider from here

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // <AuthProvider> // Removed
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-secondary p-4">
        {children}
      </div>
    // </AuthProvider> // Removed
  );
}
