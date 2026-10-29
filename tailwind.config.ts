import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0d0d0d",
        surface: "#181426",
        brand: {
          DEFAULT: "#D96299",
          light: "#e68ab5",
          dark: "#b5467a",
          glow: "rgba(217, 98, 153, 0.25)",
        },
      },
      backgroundImage: {
        "glass-gradient":
          "linear-gradient(135deg, rgba(24, 20, 38, 0.78) 0%, rgba(13, 13, 13, 0.88) 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
