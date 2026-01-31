"use client";

import { memo } from "react";
import ChatWindow from "@/features/chat/ChatWindow";
import MemoryPanel from "@/features/memory/MemoryPanel";

const HomePage = () => {
  return (
    <div className="flex h-screen">
      {/* 메인 채팅 영역 */}
      <div className="flex-1 flex flex-col">
        <ChatWindow />
      </div>

      {/* 메모리 패널 */}
      <div className="w-80 border-l border-gray-200 dark:border-gray-800">
        <MemoryPanel />
      </div>
    </div>
  );
};

export default memo(HomePage);
