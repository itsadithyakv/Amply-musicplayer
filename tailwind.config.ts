import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        amply: {
          bgPrimary: '#0F0F0F',
          bgSecondary: '#121212',
          card: '#181818',
          hover: '#202020',
          border: '#2A2A2A',
          textPrimary: '#FFFFFF',
          textSecondary: '#B3B3B3',
          textMuted: '#7A7A7A',
          accent: '#FF7A1A',
          accentHover: '#FF8F3A',
        },
      },
      borderRadius: {
        card: '12px',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      spacing: {
        2: '8px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      boxShadow: {
        card: '0 10px 25px rgba(0,0,0,0.25)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseCurrentLyric: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.02)' },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 400ms ease-out',
        pulseCurrentLyric: 'pulseCurrentLyric 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
