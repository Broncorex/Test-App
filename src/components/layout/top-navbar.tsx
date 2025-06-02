
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
import { Icons } from "@/components/icons"
import { cn } from "@/lib/utils"
import { navItems, APP_NAME } from "@/lib/constants"
import type { NavItemStructure } from "@/types"
import { useAuth } from "@/hooks/use-auth-store.tsx"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "../ui/scroll-area"

const ListItem = React.forwardRef<
  React.ElementRef<"a">,
  React.ComponentPropsWithoutRef<"a"> & { isActive?: boolean }
>(({ className, title, children, isActive, ...props }, ref) => {
  return (
    <li>
      <NavigationMenuLink asChild>
        <a
          ref={ref}
          className={cn(
            "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus:bg-accent focus:text-accent-foreground",
            isActive && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
            className
          )}
          {...props}
        >
          <div className="text-sm font-medium leading-none">{title}</div>
          {children && (
             <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
              {children}
            </p>
          )}
        </a>
      </NavigationMenuLink>
    </li>
  )
})
ListItem.displayName = "ListItem"


export function TopNavbar() {
  const pathname = usePathname();
  const { role, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const isNavItemAllowed = (item: NavItemStructure) => {
    return role && item.allowedRoles.includes(role);
  };

  const filteredNavItems = React.useMemo(() => {
    if (isLoading || !role) return [];
    return navItems
      .filter(isNavItemAllowed)
      .map(item => ({
        ...item,
        subItems: item.subItems?.filter(isNavItemAllowed)
      }))
      .filter(item => {
        if (item.subItems) {
          return item.subItems.length > 0;
        }
        return true;
      });
  }, [role, isLoading]);

  const getEffectiveHref = (item: NavItemStructure) => {
    if (item.subItems && item.subItems.length > 0) {
      const firstAllowedSubItem = item.subItems.find(subItem => role && subItem.allowedRoles.includes(role));
      return firstAllowedSubItem?.href || item.href;
    }
    return item.href;
  };


  if (isLoading) {
    // Skeleton for loading state
    return (
        <div className="flex items-center space-x-1 h-10">
            {Array.from({length: 4}).map((_, i) => (
                <div key={i} className="h-8 w-24 animate-pulse rounded-md bg-muted/50"></div>
            ))}
        </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Icons.Menu className="h-6 w-6" />
            <span className="sr-only">Toggle Menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-full max-w-xs p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-4">
            <SheetTitle>
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                <Icons.Logo className="h-7 w-7 text-primary" />
                <span className="font-bold text-lg">{APP_NAME}</span>
                </Link>
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-4rem-1px)]">
            <nav className="flex flex-col space-y-1 p-4">
              {filteredNavItems.map((item) => (
                <React.Fragment key={item.href}>
                  {item.subItems && item.subItems.length > 0 ? (
                    <div className="flex flex-col">
                       <Link
                          href={getEffectiveHref(item)}
                          className={cn(
                            "block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent hover:text-accent-foreground",
                            item.subItems.some(sub => pathname.startsWith(sub.href)) && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                          )}
                           onClick={() => setMobileMenuOpen(false)}
                        >
                          {item.label}
                        </Link>
                        <div className="ml-4 mt-1 flex flex-col border-l-2 border-muted pl-3 space-y-1">
                          {item.subItems.map((subItem) => (
                             <Link
                              key={subItem.href}
                              href={subItem.href}
                              className={cn(
                                "block rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                                pathname === subItem.href || (subItem.href !== "/" && pathname.startsWith(subItem.href))
                                  ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                                  : "text-muted-foreground hover:text-primary"
                              )}
                              onClick={() => setMobileMenuOpen(false)}
                            >
                              {subItem.label}
                            </Link>
                          ))}
                        </div>
                    </div>
                  ) : (
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-md px-3 py-2 text-base font-medium hover:bg-accent hover:text-accent-foreground",
                        pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                          : "text-foreground"
                      )}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <NavigationMenu>
      <NavigationMenuList>
        {filteredNavItems.map((item, index) => {
          const isLastItem = index === filteredNavItems.length - 1 && filteredNavItems.length > 1;
          const contentAlign = (filteredNavItems.length > 2 && index > filteredNavItems.length / 2) ? "end" : "start";


          if (item.subItems && item.subItems.length > 0) {
            return (
              <NavigationMenuItem key={item.href}>
                <NavigationMenuTrigger
                  className={cn(item.subItems.some(sub => pathname.startsWith(sub.href)) && "data-[state=closed]:bg-primary data-[state=closed]:text-primary-foreground")}
                >
                   <Link href={getEffectiveHref(item)} legacyBehavior passHref>
                    <span>{item.label}</span>
                  </Link>
                </NavigationMenuTrigger>
                <NavigationMenuContent align={contentAlign}>
                  <ul className={cn(
                      "grid w-full gap-1 py-1 bg-popover text-popover-foreground border rounded-md shadow-lg", // Added w-full
                    )}
                  >
                    {item.subItems.map((subItem) => (
                      <ListItem
                        key={subItem.href}
                        href={subItem.href}
                        title={subItem.label}
                        isActive={pathname === subItem.href || (subItem.href !== "/" && pathname.startsWith(subItem.href))}
                      />
                    ))}
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>
            );
          }
          return (
            <NavigationMenuItem key={item.href}>
              <Link href={item.href} legacyBehavior passHref>
                <NavigationMenuLink className={cn(
                  navigationMenuTriggerStyle(),
                  (pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))) && "bg-primary text-primary-foreground"
                )}>
                  {item.label}
                </NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
