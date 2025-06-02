
"use client";

import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Icons } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line } from "recharts";
import type { ChartConfig } from "@/components/ui/chart";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton"; // Added import

const barChartData = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 },
];

const barChartConfig = {
  desktop: { label: "Desktop", color: "hsl(var(--chart-1))" },
  mobile: { label: "Mobile", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const lineChartData = [
  { date: "2024-01-01", value: 120 },
  { date: "2024-01-02", value: 150 },
  { date: "2024-01-03", value: 130 },
  { date: "2024-01-04", value: 180 },
  { date: "2024-01-05", value: 160 },
  { date: "2024-01-06", value: 200 },
];

const lineChartConfig = {
  value: { label: "Stock Value", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;


export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000); // Simulate data loading
    return () => clearTimeout(timer);
  }, []);

  const stats = [
    { title: "Total Items", value: "1,234", icon: Icons.Package, description: "+20.1% from last month", isLoading },
    { title: "Low Stock Alerts", value: "52", icon: Icons.AlertTriangle, description: "3 items critical", isLoading },
    { title: "Warehouses", value: "7", icon: Icons.Warehouses, description: "2 new this year", isLoading },
    { title: "Total Stock Value", value: "$250.5K", icon: Icons.DollarSign, description: "+5% from last quarter", isLoading },
  ];

  return (
    <>
      <PageHeader
        title="Inventory Dashboard"
        description="Overview of your current inventory status and activities."
      />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {stats.map((stat) => (
          <StatsCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline">Stock Movements Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[300px] w-full" /> : (
              <ChartContainer config={barChartConfig} className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barChartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="desktop" fill="var(--color-desktop)" radius={4} />
                    <Bar dataKey="mobile" fill="var(--color-mobile)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline">Stock Value Trend</CardTitle>
          </CardHeader>
          <CardContent>
             {isLoading ? <Skeleton className="h-[300px] w-full" /> : (
              <ChartContainer config={lineChartConfig} className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineChartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                    <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tickLine={false} axisLine={false} tickMargin={8}/>
                    <YAxis tickLine={false} axisLine={false} tickMargin={8}/>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
             )}
          </CardContent>
        </Card>
      </div>
      
      <Card className="mt-6 shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between p-2 rounded-md hover:bg-muted"><span>Registered 50 units of "Product X" (Inbound)</span> <span className="text-muted-foreground">2 hours ago</span></li>
              <li className="flex justify-between p-2 rounded-md hover:bg-muted"><span>Shipped 20 units of "Product Y" (Outbound)</span> <span className="text-muted-foreground">5 hours ago</span></li>
              <li className="flex justify-between p-2 rounded-md hover:bg-muted"><span>User 'Admin' updated "Warehouse A" details.</span> <span className="text-muted-foreground">1 day ago</span></li>
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
