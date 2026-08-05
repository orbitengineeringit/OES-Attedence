/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#F8FAFC',
          surface: 'rgba(255,255,255,0.75)',
          border: 'rgba(148,163,184,0.24)',
          cyan: '#14B8A6',
          blue: '#3B82F6',
          green: '#10B981',
          red: '#EF4444',
          gold: '#F59E0B',
        },
        premium: {
          bg: '#F8FAFC',
          surface: 'rgba(255, 255, 255, 0.75)',
          surfaceStrong: 'rgba(255, 255, 255, 0.85)',
          border: 'rgba(148, 163, 184, 0.24)',
          primary: '#4F46E5',
          primarySoft: '#6366F1',
          blue: '#3B82F6',
          teal: '#14B8A6',
          green: '#10B981',
          red: '#EF4444',
          amber: '#F59E0B',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        premium: '0 18px 60px rgba(15, 23, 42, 0.08)',
        premiumStrong: '0 24px 72px rgba(15, 23, 42, 0.12)',
      },
      animation: {
        'pulse-slow': 'pulse 6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-line': 'scan 4s linear infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        }
      }
    },
  },
  plugins: [],
}
