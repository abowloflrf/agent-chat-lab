import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { DEFAULT_THEME, THEME_UI_COLORS } from "@/lib/theme-constants";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Default browser-UI color (= default theme). The anti-flash script and
  // lib/theme.ts mutate this <meta> at runtime to follow the active theme.
  themeColor: THEME_UI_COLORS[DEFAULT_THEME],
};

export const metadata: Metadata = {
  title: "Agent Chat Lab",
  description:
    "一个用于学习最小 Agent 构建流程的教学型 Web 应用，包含聊天、工具调用和基础记忆。",
  appleWebApp: {
    capable: true,
    title: "Agent Chat Lab",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      // Browser extensions (Dark Reader, translators, etc.) mutate <html> class
      // before hydration; suppress the resulting benign attribute mismatch.
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full`}
    >
      <head>
        {/* Apply the persisted color theme before first paint to avoid a flash,
            and sync the browser-UI <meta name="theme-color"> to it. Runs
            synchronously during HTML parsing; default warm == :root. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=${JSON.stringify(
              THEME_UI_COLORS,
            )},t=localStorage.getItem("color-theme");if(t&&c[t]){document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m)}m.setAttribute("content",c[t])}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
