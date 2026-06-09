/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: ["Space Grotesk", "Inter", "sans-serif"],
      },
      colors: {
        // Zornade brand teal (= hsl(185 55% 44%) from the main site).
        zornade: {
          DEFAULT: "#32a4ae",
          50: "#f0fafb",
          100: "#d7f0f2",
          600: "#2b8e97",
          700: "#01646f",
          900: "#0a3b40",
        },
      },
    },
  },
  plugins: [],
};
