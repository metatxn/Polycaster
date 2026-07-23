import { fonts, theme } from "../theme";

/** Browser-chrome wrapper for knoww.app web-app shots (scenes 07, 08). */
export const BrowserVignette: React.FC<{
  url?: string;
  children?: React.ReactNode;
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
}> = ({ url = "knoww.app", children, width = 1440, height = 780, style }) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: "hidden",
        background: theme.bgCard,
        border: `1px solid ${theme.ruleFaint}`,
        boxShadow: "0 40px 120px -50px rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {/* Chrome bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 20px",
          borderBottom: `1px solid ${theme.ruleFaint}`,
          background: theme.bgAlt,
        }}
      >
        <div style={{ display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div
              key={c}
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: c,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              padding: "8px 22px",
              borderRadius: 999,
              background: theme.bg,
              border: `1px solid ${theme.ruleFaint}`,
              fontFamily: fonts.mono,
              fontSize: 16,
              color: theme.fgMuted,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: theme.accentText }}>▲</span>
            {url}
          </div>
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
