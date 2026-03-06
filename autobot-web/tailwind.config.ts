import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#e5e5e5",
        "background-light": "#F3F4F6",
        "background-dark": "#0a0a0a",
        "surface-dark": "#141414",
        "border-dark": "#2a2a2a",
        "accent-cyan": "#22d3ee",
        "accent-green": "#4ade80",
        "accent-amber": "#fbbf24",
        // Keep old names mapped to new colors for any missed references
        "accent-blue": "#22d3ee",
        "accent-purple": "#22d3ee",
      },
      fontFamily: {
        sans: ["'Space Mono'", "monospace"],
        mono: ["'Space Mono'", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        xl: "0.375rem",
        "2xl": "0.5rem",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        blink: "blink 1s step-end infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
