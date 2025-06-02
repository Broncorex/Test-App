
"use client";

// This form is no longer used for public signup as per new requirements.
// Users are registered by admins/superadmins.
// Keeping the file for now, but it's not linked in the main auth flow.

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
// import { useAuth } from "@/hooks/use-auth-store"; // Public signup not used
import { Icons } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
});

export function SignupForm() {
  // const { signup, isLoading } = useAuth(); // Public signup not used
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false); // Mock loading state

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    // await signup(values.email, values.password, values.name); // Public signup not used
    setIsLoading(true);
    toast({
        title: "Public Signup Disabled",
        description: "New users must be registered by an administrator.",
        variant: "destructive",
    });
    setTimeout(() => setIsLoading(false), 1000);
  }

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center items-center gap-2 mb-4">
          <Icons.Logo className="h-10 w-10 text-primary" />
          <CardTitle className="text-3xl font-bold">{APP_NAME}</CardTitle>
        </div>
        <CardDescription>Public account creation is currently disabled.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} disabled />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="user@example.com" {...field} disabled />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} disabled />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled>
              {isLoading ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Signup className="mr-2 h-4 w-4" />}
              {isLoading ? "Processing..." : "Sign Up (Disabled)"}
            </Button>
             <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Log in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

// Need to add useState import if not already present at top of file
import { useState } from "react";
