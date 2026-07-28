import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "双兔助手",
    short_name: "双兔助手",
    description: "A股日内做T监控与提醒",
    start_url: "/?view=desk",
    display: "standalone",
    background_color: "#07110f",
    theme_color: "#07110f",
    lang: "zh-CN",
    icons: [
      { src: "/rabbit-logo-compact.png", sizes: "192x192", type: "image/png" },
      { src: "/rabbit-logo-compact.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
