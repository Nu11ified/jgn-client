"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Users, Shield, Link2, Ban, LayoutDashboard, UserSquare, Server, MessageSquareQuote
} from "lucide-react";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/servers", label: "Servers", icon: Server },
  { href: "/admin/roles", label: "Discord Roles", icon: UserSquare }, // Using UserSquare for Discord Roles
  { href: "/admin/teamspeak-groups", label: "TS Groups", icon: MessageSquareQuote }, // Using MessageSquareQuote for TS Groups 
  { href: "/admin/role-mappings", label: "Role Mappings", icon: Link2 },
  { href: "/admin/ban-history", label: "Ban History", icon: Ban },
];

export function AdminNavbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-card/80 backdrop-blur-md p-3 rounded-xl shadow-lg sticky top-4 z-50 max-w-fit mx-auto">
      <ul className="flex items-center justify-center space-x-1 sm:space-x-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <item.icon className={cn("h-4 w-4 sm:h-5 sm:w-5", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground")} />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden text-xs">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
} 