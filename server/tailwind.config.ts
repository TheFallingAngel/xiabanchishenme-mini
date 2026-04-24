import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FFFEF9",
        "deep-red": "#C41E3A",
        "deep-red-dark": "#A3182F",
        gold: "#D4AF37",
        "gold-light": "#F5E6B8",
        secondary: "#2D3748",
        muted: "#718096",
        surface: "#FFFEF9",
        // keep legacy aliases
        primary: "#C41E3A",
        "primary-dark": "#A3182F",
        accent: "#D4AF37",
      },
      boxShadow: {
        card: "0 2px 12px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 20px rgba(0,0,0,0.1)",
        float: "0 8px 30px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
