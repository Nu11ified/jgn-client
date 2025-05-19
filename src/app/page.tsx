import Link from "next/link";
import { api, HydrateClient } from "@/trpc/server";
import { HeroSection } from "@/components/blocks/hero-section-1";

export default async function Home() {

  return (
    <HydrateClient>
      <HeroSection />
    </HydrateClient>
  );
}
