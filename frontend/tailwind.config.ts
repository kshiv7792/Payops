import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { brand: "#2864ed", ink: "#101b34" } } },
  plugins: [],
};

export default config;
