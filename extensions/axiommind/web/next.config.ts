import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/ax",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
