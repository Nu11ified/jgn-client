"use client";

import React from 'react';
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, FileText, CheckSquare, UserCheck } from "lucide-react"; // Added icons
import UserFormList from "@/app/_components/dashboard/forms/UserFormList";
import UserFilledForms from "@/app/_components/dashboard/forms/UserFilledForms";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function UserFormsPage() {
  return (
    <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">
        Forms Hub
      </h1>
      <Tabs defaultValue="available" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 md:w-auto mb-6">
          <TabsTrigger value="available">Available Forms</TabsTrigger>
          <TabsTrigger value="filled">My Submissions</TabsTrigger>
          <TabsTrigger value="reviewer">Review Tasks</TabsTrigger>
          <TabsTrigger value="approver">Approval Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="available">
          <UserFormList />
        </TabsContent>
        <TabsContent value="filled">
          <UserFilledForms />
        </TabsContent>
        <TabsContent value="reviewer">
          <div className="grid gap-6 md:grid-cols-1">
            <Card className="transform transition-all hover:scale-105 hover:shadow-lg">
              <CardHeader>
                <UserCheck className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Forms to Review</CardTitle>
                <CardDescription>Access and process forms awaiting your review.</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard/form/reviewer" className="block">
                  <Button className="w-full" variant="outline">
                    Go to Reviewer Dashboard <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="approver">
          <div className="grid gap-6 md:grid-cols-1">
             <Card className="transform transition-all hover:scale-105 hover:shadow-lg">
              <CardHeader>
                <CheckSquare className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Forms for Final Approval</CardTitle>
                <CardDescription>Access and process forms awaiting your final approval.</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard/form/finalapprover" className="block">
                  <Button className="w-full" variant="outline">
                    Go to Final Approver Dashboard <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
            <Card className="transform transition-all hover:scale-105 hover:shadow-lg mt-4">
              <CardHeader>
                <FileText className="h-8 w-8 mb-2 text-primary" />
                <CardTitle>Final Approval History</CardTitle>
                <CardDescription>View outcome history for all forms where you are a designated final approver.</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard/form/finalapprover/history" className="block">
                  <Button className="w-full" variant="outline">
                    View Approval History <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
} 