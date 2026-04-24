import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "./BottomNav";

export const metadata: Metadata = {
  title: "下班吃什么",
  description: "下班后 1 分钟搞定晚饭决策",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "下班吃什么",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-cream min-h-screen overscroll-none">
        <div className="pb-safe">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
