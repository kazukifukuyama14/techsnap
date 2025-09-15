/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["http://192.168.0.187:3000"],
  async rewrites() {
    return [
      // GitLab Blog 画像の相対参照対策（外部記事由来の /images/blog/* をプロキシ）
      {
        source: "/images/blog/:path*",
        destination: "https://about.gitlab.com/images/blog/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
