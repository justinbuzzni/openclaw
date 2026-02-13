"use client";

import { memo } from "react";
import Dashboard from "@/features/dashboard/Dashboard";

const DashboardPage = () => {
  return (
    <main className="relative flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Ambient Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-emerald-600/10 blur-[120px] animate-pulse-slow" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-cyan-600/10 blur-[100px] animate-pulse-slow" style={{ animationDelay: "2s" }} />
      </div>

      <div className="z-10 flex w-full h-full max-w-[1920px] mx-auto glass shadow-2xl overflow-hidden md:m-4 md:rounded-2xl md:border md:border-white/10 md:h-[calc(100vh-2rem)]">
        <Dashboard />
      </div>
    </main>
  );
};

export default memo(DashboardPage);
