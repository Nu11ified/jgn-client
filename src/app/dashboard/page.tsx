"use client";

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Users, FileText, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="container mx-auto min-h-[calc(100vh-8rem)] py-4 px-4 sm:py-8 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Dashboard
        </h1>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Welcome back! Choose a section to get started.
        </p>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto">
        {/* Departments Card */}
        <Card className="group w-full transform transition-all duration-200 hover:scale-[1.02] hover:shadow-lg dark:hover:shadow-gray-800/25 border-2 hover:border-blue-200 dark:hover:border-blue-800">
          <CardHeader className="pb-3 sm:pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-800/40 transition-colors">
                <Users className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg sm:text-xl lg:text-2xl font-bold">Departments</CardTitle>
            </div>
            <CardDescription className="text-sm sm:text-base leading-relaxed">
              Access and manage departments, view rosters, and handle administrative tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href="/dashboard/departments" className="block">
              <Button className="w-full text-sm sm:text-base py-2 sm:py-3" variant="default">
                Go to Departments 
                <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Forms Card */}
        <Card className="group w-full transform transition-all duration-200 hover:scale-[1.02] hover:shadow-lg dark:hover:shadow-gray-800/25 border-2 hover:border-green-200 dark:hover:border-green-800">
          <CardHeader className="pb-3 sm:pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-800/40 transition-colors">
                <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-lg sm:text-xl lg:text-2xl font-bold">Forms</CardTitle>
            </div>
            <CardDescription className="text-sm sm:text-base leading-relaxed">
              Access, submit, and manage forms for various department processes and requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href="/dashboard/form" className="block">
              <Button className="w-full text-sm sm:text-base py-2 sm:py-3" variant="default">
                Go to Forms 
                <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Profile Card */}
        <Card className="group w-full sm:col-span-2 lg:col-span-1 transform transition-all duration-200 hover:scale-[1.02] hover:shadow-lg dark:hover:shadow-gray-800/25 border-2 hover:border-purple-200 dark:hover:border-purple-800">
          <CardHeader className="pb-3 sm:pb-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-800/40 transition-colors">
                <User className="h-5 w-5 sm:h-6 sm:w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-lg sm:text-xl lg:text-2xl font-bold">Profile</CardTitle>
            </div>
            <CardDescription className="text-sm sm:text-base leading-relaxed">
              View and manage your personal profile, settings, and account preferences.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href="/dashboard/profile" className="block">
              <Button className="w-full text-sm sm:text-base py-2 sm:py-3" variant="default">
                Go to Profile 
                <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Optional: Quick Stats or Recent Activity Section */}
      <div className="mt-8 sm:mt-12 lg:mt-16">
        <div className="text-center">
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            Need help? Check out the documentation or contact support.
          </p>
        </div>
      </div>
    </div>
  );
} 