import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Attenza",
    short_name: "Attenza",
    description: "Attenza — HR without the follow-up · Atriowings Technologies",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#4F46E5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
