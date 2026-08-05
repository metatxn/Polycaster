import { Img, staticFile } from "remotion";

/** The editorial K-mark (diamond-cutout K). Single source: public/knoww-k-mark.png. */
export const KMark: React.FC<{
  size?: number;
  style?: React.CSSProperties;
}> = ({ size = 96, style }) => {
  return (
    <Img
      src={staticFile("knoww-k-mark.png")}
      style={{ width: size, height: size, objectFit: "contain", ...style }}
    />
  );
};
