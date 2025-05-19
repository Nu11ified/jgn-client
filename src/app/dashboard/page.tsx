import Link from 'next/link';
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const DashboardHomePage = () => {
  return (
    <div className="container mx-auto min-h-screen py-12 px-4 md:px-6 lg:px-8 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight text-center mb-12">
          User Dashboard
        </h1>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome!</CardTitle>
            <CardDescription>
              This is your central hub for managing your information and activities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-muted-foreground">
              Explore the sections below to get started.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/dashboard/profile">
                  View Your Profile
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {/* Add more navigation buttons or dashboard widgets here as needed */}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DashboardHomePage; 