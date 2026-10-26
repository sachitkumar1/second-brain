import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Apollo",
    short_name: "Apollo",
    description: "Classes, messages, email, calendar and reminders in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#003262",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
