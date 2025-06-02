"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";


const mockStockData = {
  "prod_1": [ // Laptop Pro 15
    { warehouse: "Main WH", quantity: 150, color: "hsl(var(--chart-1))" },
    { warehouse: "West Coast Hub", quantity: 75, color: "hsl(var(--chart-2))" },
    { warehouse: "Central Depot", quantity: 50, color: "hsl(var(--chart-3))" },
  ],
  "prod_2": [ // Wireless Mouse
    { warehouse: "Main WH", quantity: 300, color: "hsl(var(--chart-1))" },
    { warehouse: "West Coast Hub", quantity: 200, color: "hsl(var(--chart-2))" },
    { warehouse: "Central Depot", quantity: 150, color: "hsl(var(--chart-3))" },
  ],
  "prod_3": [ // Mechanical Keyboard
    { warehouse: "Main WH", quantity: 100, color: "hsl(var(--chart-1))" },
    { warehouse: "West Coast Hub", quantity: 0, color: "hsl(var(--chart-2))" }, // Example of zero stock
    { warehouse: "Central Depot", quantity: 80, color: "hsl(var(--chart-3))" },
  ],
   "prod_4": [ // 4K Monitor 27
    { warehouse: "Main WH", quantity: 90, color: "hsl(var(--chart-1))" },
    { warehouse: "West Coast Hub", quantity: 60, color: "hsl(var(--chart-2))" },
    { warehouse: "Central Depot", quantity: 40, color: "hsl(var(--chart-3))" },
  ],
};

const mockProducts = [
  { id: "prod_1", name: "Laptop Pro 15" },
  { id: "prod_2", name: "Wireless Mouse" },
  { id: "prod_3", name: "Mechanical Keyboard" },
  { id: "prod_4", name: "4K Monitor 27" },
];


const barChartConfig = {
  quantity: { label: "Quantity", color: "hsl(var(--chart-1))" }, // Default, will be overridden by data
} satisfies ChartConfig;


export default function VisualizeStockPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<string>(mockProducts[0].id);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    setIsLoading(true);
    // Simulate data loading for the selected product
    const data = mockStockData[selectedProduct as keyof typeof mockStockData] || [];
    setChartData(data);
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, [selectedProduct]);

  const dynamicChartConfig: ChartConfig = chartData.reduce((config, item) => {
    config[item.warehouse] = { label: item.warehouse, color: item.color };
    return config;
  }, {});


  return (
    <>
      <PageHeader
        title="Visualize Stock Distribution"
        description="See how products are distributed across your warehouses."
      />
      
      <div className="mb-6">
        <Label htmlFor="product-select" className="text-lg font-medium">Select Product:</Label>
        <Select value={selectedProduct} onValueChange={setSelectedProduct}>
          <SelectTrigger id="product-select" className="w-full md:w-[300px] mt-2">
            <SelectValue placeholder="Select a product" />
          </SelectTrigger>
          <SelectContent>
            {mockProducts.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline">Stock per Warehouse (Bar Chart)</CardTitle>
            <p className="text-sm text-muted-foreground">Distribution for: {mockProducts.find(p => p.id === selectedProduct)?.name}</p>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[350px] w-full" /> : (
              <ChartContainer config={barChartConfig} className="h-[350px] w-full">
                <ResponsiveContainer>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis dataKey="warehouse" type="category" width={100} tickLine={false} axisLine={false}/>
                    <ChartTooltip cursor={{fill: 'hsl(var(--muted))'}} content={<ChartTooltipContent />} />
                    <Bar dataKey="quantity" radius={4}>
                       {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline">Stock Distribution (Pie Chart)</CardTitle>
             <p className="text-sm text-muted-foreground">Distribution for: {mockProducts.find(p => p.id === selectedProduct)?.name}</p>
          </CardHeader>
          <CardContent>
             {isLoading ? <Skeleton className="h-[350px] w-full" /> : (
              <ChartContainer config={dynamicChartConfig} className="h-[350px] w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="warehouse" />} />
                    <Pie
                      data={chartData}
                      dataKey="quantity"
                      nameKey="warehouse"
                      cx="50%"
                      cy="50%"
                      outerRadius={120}
                      label={({ warehouse, percent }) => `${warehouse} ${(percent * 100).toFixed(0)}%`}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                     <ChartLegend
                      content={<ChartLegendContent nameKey="warehouse" />}
                      verticalAlign="bottom"
                      align="center"
                      wrapperStyle={{ paddingTop: '20px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
             )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
