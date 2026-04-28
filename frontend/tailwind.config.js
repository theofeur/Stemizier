/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        stem: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          accent: "#7c3aed",
          "accent-hover": "#8b5cf6",
          vocals: "#f43f5e",
          drums: "#f97316",
          bass: "#3b82f6",
          other: "#a855f7",
          instrumental: "#22c55e",
        },
      },
    },
  },
  plugins: [],
};
