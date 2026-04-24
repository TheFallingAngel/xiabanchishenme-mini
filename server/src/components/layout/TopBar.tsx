"use client";

import { MapPin, ChevronDown } from "lucide-react";

interface TopBarProps {
  locationName?: string;
  onLocationClick?: () => void;
}

export default function TopBar({ locationName, onLocationClick }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 bg-cream/90 backdrop-blur-md">
      <div className="flex justify-between items-center px-4 h-14">
        <h1 className="text-2xl font-bold text-secondary">下班吃什么</h1>
      </div>
      {locationName && (
        <div className="px-4 pb-2">
          <button
            onClick={onLocationClick}
            className="flex items-center gap-1.5 text-sm text-muted"
          >
            <MapPin size={14} className="text-deep-red" />
            <span className="max-w-[200px] truncate">{locationName}</span>
            <ChevronDown size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
