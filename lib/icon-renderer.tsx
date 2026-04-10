import { ImageResponse } from "next/og";

/**
 * Renders the Agent Chat Lab app icon at the given size.
 * Shared across favicon, apple-icon, and PWA manifest icons.
 */
export function renderAppIcon(size: number): ImageResponse {
  // Scale factor relative to the 180px "base" design
  const s = size / 180;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #1b1712, #2a2118)",
          borderRadius: Math.round(40 * s),
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Top-left accent glow */}
        <div
          style={{
            position: "absolute",
            top: Math.round(-20 * s),
            left: Math.round(-20 * s),
            width: Math.round(100 * s),
            height: Math.round(100 * s),
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(201,106,43,0.4), transparent 70%)",
          }}
        />
        {/* Bottom-right subtle glow */}
        <div
          style={{
            position: "absolute",
            bottom: Math.round(-30 * s),
            right: Math.round(-30 * s),
            width: Math.round(90 * s),
            height: Math.round(90 * s),
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(201,106,43,0.15), transparent 70%)",
          }}
        />
        {/* Grid pattern overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.06,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: `${Math.round(18 * s)}px ${Math.round(18 * s)}px`,
          }}
        />
        {/* Node dots */}
        {size >= 128 && (
          <>
            <div
              style={{
                position: "absolute",
                top: Math.round(32 * s),
                right: Math.round(36 * s),
                width: Math.round(6 * s),
                height: Math.round(6 * s),
                borderRadius: "50%",
                background: "rgba(201,106,43,0.5)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: Math.round(22 * s),
                right: Math.round(56 * s),
                width: Math.round(4 * s),
                height: Math.round(4 * s),
                borderRadius: "50%",
                background: "rgba(201,106,43,0.3)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: Math.round(30 * s),
                left: Math.round(34 * s),
                width: Math.round(5 * s),
                height: Math.round(5 * s),
                borderRadius: "50%",
                background: "rgba(201,106,43,0.35)",
              }}
            />
          </>
        )}
        {/* Main chat bubble */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(6 * s),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: Math.round(100 * s),
              height: Math.round(76 * s),
              background: "linear-gradient(135deg, #c96a2b, #e0853e)",
              borderRadius: `${Math.round(22 * s)}px ${Math.round(22 * s)}px ${Math.round(22 * s)}px ${Math.round(4 * s)}px`,
              boxShadow: `0 ${Math.round(8 * s)}px ${Math.round(32 * s)}px rgba(201,106,43,0.35), 0 ${Math.round(2 * s)}px ${Math.round(8 * s)}px rgba(0,0,0,0.3)`,
            }}
          >
            {/* Three dots */}
            <div
              style={{
                display: "flex",
                gap: Math.round(8 * s),
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: Math.round(12 * s),
                  height: Math.round(12 * s),
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.95)",
                }}
              />
              <div
                style={{
                  width: Math.round(12 * s),
                  height: Math.round(12 * s),
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.65)",
                }}
              />
              <div
                style={{
                  width: Math.round(12 * s),
                  height: Math.round(12 * s),
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.35)",
                }}
              />
            </div>
          </div>
          {/* Accent bar */}
          {size >= 128 && (
            <div
              style={{
                width: Math.round(40 * s),
                height: Math.max(2, Math.round(3 * s)),
                borderRadius: Math.round(2 * s),
                background:
                  "linear-gradient(90deg, rgba(201,106,43,0.7), rgba(201,106,43,0.1))",
              }}
            />
          )}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
