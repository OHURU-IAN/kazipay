import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-mode badge so local screenshots and demo recordings stay clean.
  devIndicators: false,
};

export default nextConfig;
