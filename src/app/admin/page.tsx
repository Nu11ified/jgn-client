import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap } from 'lucide-react';

const AdminHomePage = () => {
  return (
    <div className="flex flex-col items-center justify-center">
      <Card className="w-full max-w-xl shadow-lg">
        <CardHeader className="items-center">
          <Zap className="h-12 w-12 text-primary mb-4" />
          <CardTitle className="text-3xl font-bold text-center">Admin Panel</CardTitle>
          <CardDescription className="text-center mt-2">
            Welcome to the JGN Admin Panel. Use the navigation above to manage different aspects of the application.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-muted-foreground">
            Select a section to view and manage data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminHomePage; 