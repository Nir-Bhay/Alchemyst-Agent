import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0d10",
          panel: "#11151a",
          subtle: "#161b22",
        },
        line: "#1f2937",
        ink: {
          DEFAULT: "#e6edf3",
          dim: "#9aa4b2",
          faint: "#5b6470",
        },
        accent: {
          DEFAULT: "#3b82f6",
          ok: "#22c55e",
          warn: "#f59e0b",
          err: "#ef4444",
          tool: "#a855f7",
        },
        diff: {
          add: "#16a34a",
          remove: "#dc2626",
          change: "#d97706",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulseDot 1.1s ease-in-out infinite",
        "fade-in": "fadeIn 120ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
