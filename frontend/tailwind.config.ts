import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#effaf8",
          100: "#d7f2ec",
          200: "#b0e4da",
          300: "#7fcfc2",
          400: "#4fb4a6",
          500: "#32998c",
          600: "#257b72",
          700: "#21635d",
          800: "#1e504c",
          900: "#1c4340",
        },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
