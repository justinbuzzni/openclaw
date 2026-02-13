"use client";

import { memo, useState, useCallback } from "react";
import ChatWindow from "@/features/chat/ChatWindow";
import MemoryPanel from "@/features/memory/MemoryPanel";
import Sidebar from "@/features/chat/Sidebar";
import { useGateway } from "@/features/chat/_hooks/useGateway";

const HomePage = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { switchSession, createNewSession } = useGateway();

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return (
    <main className="relative flex h-screen w-full bg-background overflow-hidden text-foreground">
      {/* Ambient Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full bg-primary-600/10 blur-[120px] animate-pulse-slow" />
        <div
          className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[100px] animate-pulse-slow"
          style={{ animationDelay: "2s" }}
        />
      </div>

      <div className="z-10 flex w-full h-full">
        {/* Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={handleToggleSidebar}
          onSwitchSession={switchSession}
          onNewSession={createNewSession}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex max-w-[1920px] mx-auto glass shadow-2xl overflow-hidden md:m-4 md:rounded-2xl md:border md:border-white/10 md:h-[calc(100vh-2rem)]">
          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col relative min-w-0">
            <ChatWindow sidebarOpen={sidebarOpen} onToggleSidebar={handleToggleSidebar} />
          </div>

          {/* Memory Panel (Desktop) */}
          <div className="w-[400px] hidden xl:flex flex-col border-l border-white/5 bg-surface/50 backdrop-blur-sm">
            <MemoryPanel />
          </div>
        </div>
      </div>
    </main>
  );
};

export default memo(HomePage);
