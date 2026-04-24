"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Clock, Heart, User } from "lucide-react";

const tabs = [
  { href: "/", label: "首页", icon: Home },
  { href: "/history", label: "足迹", icon: Clock },
  { href: "/favorites", label: "收藏", icon: Heart },
  { href: "/profile", label: "我的", icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/restaurant/")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 max-w-[393px] mx-auto">
      <div className="flex justify-around items-center px-4 pb-6 pt-3 bg-white/95 backdrop-blur-sm border-t border-gray-100">
        {tabs.map((tab) => {
          const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
                isActive ? "text-deep-red" : "text-muted"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : ""}`} />
              <span className={`text-xs ${isActive ? "font-medium" : ""}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
