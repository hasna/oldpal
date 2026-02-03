import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [".next/**", "dist/**", "node_modules/**"],
  },
  ...nextConfig,
];

export default config;
