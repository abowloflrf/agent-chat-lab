import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f3efe7",
          borderRadius: 34,
          fontSize: 116,
          fontWeight: 700,
          color: "#c96a2b",
        }}
      >
        A
      </div>
    ),
    { ...size },
  );
}
