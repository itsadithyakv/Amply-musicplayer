import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        amply: {
          bgPrimary: '#0D0D0D',
          bgSecondary: '#121212',
          surface: '#1A1A1A',
          panel: '#0F0F0F',
          card: '#1A1A1A',
          hover: '#1F1F1F',
          border: '#2A2A2A',
          textPrimary: '#FFFFFF',
          textSecondary: '#A0A0A0',
          textMuted: '#7A7A7A',
          accent: '#FF8A2B',
          accentHover: '#FF9B46',
          accentBlue: '#3B82F6',
          accentGreen: '#22C55E',
          accentPurple: '#A855F7',
        },
      },
      borderRadius: {
        card: '16px',
      },
      fontFamily: {
        sans: ['Satoshi', 'system-ui', 'sans-serif'],
      },
      spacing: {
        2: '8px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      boxShadow: {
        card: '0 10px 30px rgba(0,0,0,0.35)',
        lift: '0 18px 40px rgba(0,0,0,0.45)',
        glow: '0 0 0 1px rgba(255,138,43,0.25), 0 12px 30px rgba(255,138,43,0.15)',
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
