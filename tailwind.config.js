/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#22C55E',      // green-500
        'primary-dark': '#16A34A',
        danger: '#EF4444',
        'danger-dark': '#DC2626',
      },
      animation: {
        'ping-slow': 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
        'pulse-fast': 'pulse 0.8s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};
