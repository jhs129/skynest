export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "8px",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
        ContextNest MCP Host
      </h1>
      <p style={{ margin: 0, color: "#666" }}>MCP endpoint: /api/mcp</p>
    </main>
  );
}
