import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/splashboard",
  assetPrefix: "/splashboard/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
