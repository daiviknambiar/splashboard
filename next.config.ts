import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Unsplash images are served directly from their CDN via <img> tags (not next/image)
  // to comply with Unsplash's no-proxying requirement.
  // No image domain config needed.

  experimental: {},
};

export default nextConfig;
