"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Users, Link2, Ban, LayoutDashboard, UserSquare, Server, MessageSquareQuote, FileText, Building
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Home", icon: LayoutDashboard, shortLabel: "Home" },
  { href: "/admin/departments", label: "Departments", icon: Building, shortLabel: "Depts" },
  { href: "/admin/users", label: "Users", icon: Users, shortLabel: "Users" },
  { href: "/admin/servers", label: "Servers", icon: Server, shortLabel: "Servers" },
  { href: "/admin/roles", label: "Discord Roles", icon: UserSquare, shortLabel: "Roles" },
  { href: "/admin/teamspeak-groups", label: "TS Groups", icon: MessageSquareQuote, shortLabel: "TS" },
  { href: "/admin/role-mappings", label: "Role Mappings", icon: Link2, shortLabel: "Maps" },
  { href: "/admin/ban-history", label: "Ban History", icon: Ban, shortLabel: "Bans" },
  { href: "/admin/form", label: "Forms", icon: FileText, shortLabel: "Forms" },
];

export function AdminNavbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-card/80 backdrop-blur-md p-2 sm:p-3 rounded-xl shadow-lg sticky top-4 z-50 max-w-fit mx-auto">
      <ul className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto scrollbar-hide">
        {pathname !== "/admin" && (
          <li className="flex-shrink-0">
            <Link
              href="/dashboard"
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 min-h-[44px] sm:min-h-[48px]",
                "text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-95",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                "sm:flex-row sm:gap-2"
              )}
              title="Back to User Dashboard"
            >
              <LayoutDashboard className="h-5 w-5 sm:h-5 sm:w-5 text-muted-foreground" />
              <span className="hidden sm:inline whitespace-nowrap">Back to User Dashboard</span>
              <span className="sm:hidden text-[10px] leading-tight text-center">User<br />Dash</span>
            </Link>
          </li>
        )}
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <li key={item.label} className="flex-shrink-0">
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 min-h-[44px] sm:min-h-[48px]",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background active:scale-95",
                  "sm:flex-row sm:gap-2"
                )}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
              >
                <item.icon className={cn(
                  "h-5 w-5 sm:h-5 sm:w-5 flex-shrink-0", 
                  isActive ? "text-primary-foreground" : "text-muted-foreground"
                )} />
                <span className="hidden sm:inline whitespace-nowrap">{item.label}</span>
                <span className="sm:hidden text-[10px] leading-tight text-center break-words max-w-[40px]">
                  {item.shortLabel}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
} 