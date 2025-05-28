import { HeroHeader } from "@/components/blocks/hero-section-1";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <HeroHeader /> 
      <main>{children}</main>
    </>
  );
} 