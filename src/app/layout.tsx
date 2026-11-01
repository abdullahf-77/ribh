import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { brand } from "@/config/brand";
import "./globals.css";

const font = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-brand", display: "swap" });

export const metadata: Metadata = {
  title: `${brand.nameAr} | مقارنة عروض موردي أكواب المقاهي`,
  description: "حدد ما تحتاجه، ألصق عروض الموردين، واعرف أيها يطابق طلبك فعلًا وكم ستدفع وما الذي يجب توضيحه قبل الشراء.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={font.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
