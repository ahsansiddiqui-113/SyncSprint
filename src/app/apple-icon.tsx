import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon, rendered at build time from the same mark as icon.svg. */
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
          background: "linear-gradient(135deg, #8e7cf5 0%, #7b68ee 55%, #e44a8a 100%)",
        }}
      >
        <svg width="132" height="132" viewBox="0 0 64 64">
          <path d="M10 39l8-6.4c4.2 5.6 8.8 8.2 14 8.2s9.8-2.6 14-8.2l8 6.4c-6 8-13.2 12-22 12s-16-4-22-12z" fill="#ffffff" />
          <path d="M32 22.8l-14.4 12.4-6.6-7.8L32 9.6l21 17.8-6.6 7.8z" fill="#ffffff" fillOpacity="0.85" />
        </svg>
      </div>
    ),
    size
  );
}
