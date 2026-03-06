/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiBase = process.env.AUTOBOT_API_BASE_URL?.replace(/\/$/, "");
    if (!apiBase) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: "/artifacts/:path*",
        destination: `${apiBase}/artifacts/:path*`,
      },
    ];
  },
};

export default nextConfig;
