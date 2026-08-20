import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VapiGotchi — A voice creature powered by Vapi",
  description:
    "Call a live pixel creature and watch it eat, dance salsa, shower, and nap through API tools.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
