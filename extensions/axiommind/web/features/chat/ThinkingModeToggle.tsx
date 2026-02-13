"use client";

import { memo, useState } from "react";
import { useAtom } from "jotai";
import { thinkingLevelAtom } from "./_stores/chat";
import { cn } from "@/lib/utils";
import { Brain, ChevronDown, Check } from "lucide-react";

type ThinkingLevel = "none" | "low" | "medium" | "high";

const THINKING_OPTIONS: { value: ThinkingLevel; label: string; description: string }[] = [
  { value: "none", label: "No Thinking", description: "Direct responses only" },
  { value: "low", label: "Light", description: "Brief reasoning shown" },
  { value: "medium", label: "Medium", description: "Moderate depth analysis" },
  { value: "high", label: "Deep", description: "Full chain of thought" },
];

const ThinkingModeToggle = () => {
  const [thinkingLevel, setThinkingLevel] = useAtom(thinkingLevelAtom);
  const [isOpen, setIsOpen] = useState(false);

  const currentOption = THINKING_OPTIONS.find((opt) => opt.value === (thinkingLevel || "none")) || THINKING_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
          thinkingLevel && thinkingLevel !== "none"
            ? "bg-purple-500/10 text-purple-300 border border-purple-500/20 hover:bg-purple-500/20"
            : "bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10"
        )}
      >
        <Brain className={cn("w-3.5 h-3.5", thinkingLevel && thinkingLevel !== "none" ? "text-purple-400" : "")} />
        <span>{currentOption.label}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen ? "rotate-180" : "")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute bottom-full mb-2 left-0 z-50 w-56 bg-[#1a1b22] border border-white/10 rounded-xl shadow-xl overflow-hidden">
            <div className="p-2 border-b border-white/5">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider px-2">Thinking Mode</p>
            </div>
            <div className="p-1">
              {THINKING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setThinkingLevel(option.value === "none" ? null : option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                    option.value === (thinkingLevel || "none")
                      ? "bg-purple-500/10 text-purple-200"
                      : "text-gray-300 hover:bg-white/5"
                  )}
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-[10px] text-gray-500">{option.description}</p>
                  </div>
                  {option.value === (thinkingLevel || "none") && <Check className="w-4 h-4 text-purple-400" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default memo(ThinkingModeToggle);
