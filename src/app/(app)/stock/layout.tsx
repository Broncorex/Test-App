// This layout can be used for common elements within /stock/* routes
// For now, it just passes children through.
// In the future, it could have tabs for Register, Visualize, Inventory if they were under the same parent route.
export default function StockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
