export const metadata = { title: "Life Advice — preview", description: "Watch and approve your film" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fbfbfa" }}>{children}</body>
    </html>
  );
}
