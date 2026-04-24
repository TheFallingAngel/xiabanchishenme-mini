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

  // Hide on restaurant detail pages
  if (pathname.startsWith("/restaurant/")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 max-w-[393px] mx-auto z-50">
      <div className="flex justify-around py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
                active ? "text-deep-red" : "text-muted"
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? "stroke-[2.5]" : ""}`} />
              <span className={`text-xs ${active ? "font-medium" : ""}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
