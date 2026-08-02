export const metadata = { title: "LE MIRAGE — serveur" };

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body style={{
        margin: 0, background: "#12080b", color: "#e8dcc0",
        font: "15px/1.6 ui-sans-serif, system-ui, sans-serif",
      }}>{children}</body>
    </html>
  );
}
