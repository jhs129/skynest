import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ContextNest MCP Host",
  description: "MCP server host for ContextNest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
