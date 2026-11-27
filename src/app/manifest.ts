import type { MetadataRoute } from "next";

/** Installable app (PWA): "Install SyncSprint" in Chrome/Edge, "Add to Home Screen" on iOS/Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SyncSprint",
    short_name: "SyncSprint",
    description: "Plan, track and ship work together.",
    start_url: "/w",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7fb",
    theme_color: "#7b68ee",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
