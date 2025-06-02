
"use client";

import React, { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Product, Warehouse as AppWarehouse } from "@/types"; // Renamed Warehouse to AppWarehouse to avoid conflict
import { useAuth } from "@/hooks/use-auth-store"; 
import { getActiveWarehouses } from "@/services/warehouseService";


// Mock data - replace with actual data fetching
const mockInventoryFull: Product[] = [
  { id: "item_1", name: "Laptop Pro 15", sku: "LP15-001", category: "Electronics", quantity: 150, price: 1200, warehouseId: "wh_1", lastUpdated: "2024-07-20" },
  { id: "item_2", name: "Wireless Mouse", sku: "WM-002", category: "Accessories", quantity: 300, price: 25, warehouseId: "wh_1", lastUpdated: "2024-07-21" },
  { id: "item_3", name: "Mechanical Keyboard", sku: "MK-003", category: "Accessories", quantity: 100, price: 75, warehouseId: "wh_2", lastUpdated: "2024-07-19" },
  { id: "item_4", name: "4K Monitor 27", sku: "4KM-004", category: "Electronics", quantity: 90, price: 350, warehouseId: "wh_1", lastUpdated: "2024-07-22" },
  { id: "item_5", name: "USB-C Hub", sku: "UCH-005", category: "Accessories", quantity: 250, price: 40, warehouseId: "wh_3", lastUpdated: "2024-07-20" },
  { id: "item_6", name: "Laptop Stand", sku: "LS-006", category: "Ergonomics", quantity: 75, price: 30, warehouseId: "wh_2", lastUpdated: "2024-07-21" },
  { id: "item_7", name: "Webcam HD", sku: "WC-007", category: "Electronics", quantity: 120, price: 60, warehouseId: "wh_3", lastUpdated: "2024-07-18" },
  { id: "item_8", name: "Gaming Mousepad", sku: "GMP-008", category: "Accessories", quantity: 25, price: 20, warehouseId: "wh_2", lastUpdated: "2024-07-23" }, // Low stock example for wh_2
];

// This local mockWarehouses will be replaced by fetched warehouses
// const mockWarehouses = [
//   { id: "wh_1", name: "Main Warehouse (NYC)" },
//   { id: "wh_2", name: "West Coast Hub (LA)" },
//   { id: "wh_3", name: "Central Depot (CHI)" },
// ];

export default function InventoryPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState("all"); // For the filter dropdown
  const [isLoading, setIsLoading] = useState(true);
  const { appUser, role } = useAuth(); 
  const [warehouses, setWarehouses] = useState<AppWarehouse[]>([]);
  const [inventoryData, setInventoryData] = useState<Product[]>([]);

  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      try {
        const activeWarehouses = await getActiveWarehouses();
        setWarehouses(activeWarehouses);

        // Simulate fetching inventory data
        await new Promise(resolve => setTimeout(resolve, 300)); 
        let dataToSet = mockInventoryFull; // Replace with actual fetch

        if (role === 'employee' && appUser?.assignedWarehouseIds && appUser.assignedWarehouseIds.length > 0) {
          dataToSet = mockInventoryFull.filter(item => 
            appUser.assignedWarehouseIds!.includes(item.warehouseId)
          );
          // If employee is assigned to a single warehouse, pre-select it.
          // For multiple warehouses, "All" (meaning all their assigned ones) is fine.
          if (appUser.assignedWarehouseIds.length === 1) {
            setSelectedWarehouseFilter(appUser.assignedWarehouseIds[0]);
          }
        }
        setInventoryData(dataToSet);

      } catch (error) {
        console.error("Error loading inventory page data:", error);
        // toast for error
      }
      setIsLoading(false);
    }
    loadInitialData();
  }, [role, appUser]);


  const getWarehouseName = (warehouseId: string | undefined) => {
    if (!warehouseId) return "N/A";
    return warehouses.find(wh => wh.id === warehouseId)?.name || "Unknown Warehouse";
  };


  const categories = useMemo(() => {
    const cats = new Set(inventoryData.map(item => item.category));
    return ["all", ...Array.from(cats)];
  }, [inventoryData]);

  const warehousesForFilterDropdown = useMemo(() => {
    if (role === 'employee' && appUser?.assignedWarehouseIds && appUser.assignedWarehouseIds.length > 0) {
      // Employees see only their assigned warehouses in the filter
      return warehouses.filter(wh => appUser.assignedWarehouseIds!.includes(wh.id));
    }
    // Admins/Superadmins see all active warehouses
    return warehouses; 
  }, [role, appUser, warehouses]);


  const filteredInventory = useMemo(() => {
    return inventoryData.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;

      let matchesWarehouse = true;
      if (role === 'employee' && appUser?.assignedWarehouseIds && appUser.assignedWarehouseIds.length > 0) {
        // If "All" is selected in filter by an employee, it means all their assigned warehouses
        if (selectedWarehouseFilter === "all") {
            matchesWarehouse = appUser.assignedWarehouseIds.includes(item.warehouseId);
        } else {
            matchesWarehouse = item.warehouseId === selectedWarehouseFilter && appUser.assignedWarehouseIds.includes(item.warehouseId);
        }
      } else if (role !== 'employee') { // Admin or Superadmin
        matchesWarehouse = selectedWarehouseFilter === "all" || item.warehouseId === selectedWarehouseFilter;
      }
      return matchesSearch && matchesCategory && matchesWarehouse;
    });
  }, [inventoryData, searchTerm, selectedCategory, selectedWarehouseFilter, role, appUser]);

  const getStockLevelBadge = (quantity: number) => {
    if (quantity === 0) return <Badge variant="destructive">Out of Stock</Badge>;
    if (quantity < 50) return <Badge variant="secondary" className="bg-orange-400 text-white">Low Stock</Badge>; 
    return <Badge variant="default" className="bg-green-500 text-white">In Stock</Badge>;
  };

  // Determine if warehouse filter should be disabled
  const isWarehouseFilterDisabled = role === 'employee' && appUser?.assignedWarehouseIds?.length === 1;


  return (
    <>
      <PageHeader
        title="Current Inventory"
        description="View, search, and filter your current stock levels."
        actions={
          <Button variant="outline">
            <Icons.Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Inventory List</CardTitle>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              placeholder="Search by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="md:col-span-1"
              prefix={<Icons.Search className="h-4 w-4 text-muted-foreground" />}
            />
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(category => (
                  <SelectItem key={category} value={category}>
                    {category === "all" ? "All Categories" : category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedWarehouseFilter}
              onValueChange={setSelectedWarehouseFilter}
              disabled={isWarehouseFilterDisabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {role === 'employee' && appUser?.assignedWarehouseIds && appUser.assignedWarehouseIds.length > 1 ? "All My Warehouses" : "All Warehouses"}
                </SelectItem>
                {warehousesForFilterDropdown.map(wh => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : filteredInventory.length > 0 ? (
                filteredInventory.map((item) => (
                  <TableRow key={item.id + (item.warehouseId || '')}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.sku}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{getWarehouseName(item.warehouseId)}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">${item.price.toFixed(2)}</TableCell>
                    <TableCell>{getStockLevelBadge(item.quantity)}</TableCell>
                    <TableCell>{new Date(item.lastUpdated as string).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-24">
                    No inventory items match your filters or current access level.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
