"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="container mx-auto flex min-h-[calc(100vh-10rem)] items-center justify-center py-8 px-4 sm:px-6 lg:px-8 gap-4">
      <Card className="w-full max-w-md transform transition-all hover:scale-105 hover:shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Forms</CardTitle>
          <CardDescription>
            Access, submit, and manage forms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/form" className="block">
            <Button className="w-full" variant="default">
              Go to Forms <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
      <Card className="w-full max-w-md transform transition-all hover:scale-105 hover:shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Profile</CardTitle>
          <CardDescription>
            View and manage your profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/profile" className="block">
            <Button className="w-full" variant="default">
              Go to Profile <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
} 