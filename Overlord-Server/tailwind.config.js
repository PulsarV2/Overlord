/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/**/*.html", "./public/assets/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
