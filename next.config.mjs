/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // WebSocket is client-only; the server bundle is tiny.
  experimental: {
    // No special flags required.
  },
};

export default nextConfig;
