import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse は、バンドルせずに、そのまま読み込む(中でファイルを読む処理があるため)
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
