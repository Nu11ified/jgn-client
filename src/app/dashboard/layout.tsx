import { HeroHeader } from "@/components/blocks/hero-section-1";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <HeroHeader /> 
      <main>{children}</main>
      <Toaster />
    </>
  );
} 