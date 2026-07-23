import { kicker as kickerStyle, theme } from "../theme";

/** Small-caps kicker in Plus Jakarta Sans — the newspaper section label. */
export const Kicker: React.FC<{
  children: React.ReactNode;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ children, size = 26, color = theme.fgMuted, style }) => {
  return (
    <div
      style={{
        ...kickerStyle,
        fontSize: size,
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
