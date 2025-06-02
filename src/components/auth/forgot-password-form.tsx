
"use client";

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
import { useAuth } from "@/hooks/use-auth-store";
import { Icons } from "@/components/icons";
import { APP_NAME } from "@/lib/constants";

const formSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address." }),
});

export function ForgotPasswordForm() {
  const { sendPasswordReset, isLoading } = useAuth();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    await sendPasswordReset(values.email);
    form.reset(); // Clear form after submission
  }

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="space-y-1 text-center">
         <div className="flex justify-center items-center gap-2 mb-4">
          <Icons.Logo className="h-10 w-10 text-primary" />
          <CardTitle className="text-3xl font-bold">{APP_NAME}</CardTitle>
        </div>
        <CardTitle className="text-2xl">Forgot Your Password?</CardTitle>
        <CardDescription>
          Enter your email address and we'll send you a link to reset your password.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input placeholder="user@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Icons.Logo className="mr-2 h-4 w-4 animate-spin" /> : <Icons.Send className="mr-2 h-4 w-4" />}
              {isLoading ? "Sending..." : "Send Reset Link"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Log In
              </Link>
            </p>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
