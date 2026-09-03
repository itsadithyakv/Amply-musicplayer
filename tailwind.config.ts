import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        amply: {
          bgPrimary: 'rgb(var(--amply-bg-primary) / <alpha-value>)',
          bgSecondary: 'rgb(var(--amply-bg-secondary) / <alpha-value>)',
          surface: 'rgb(var(--amply-surface) / <alpha-value>)',
          panel: 'rgb(var(--amply-panel) / <alpha-value>)',
          card: 'rgb(var(--amply-card) / <alpha-value>)',
          hover: 'rgb(var(--amply-hover) / <alpha-value>)',
          border: 'rgb(var(--amply-border) / <alpha-value>)',
          textPrimary: 'rgb(var(--amply-text-primary) / <alpha-value>)',
          textSecondary: 'rgb(var(--amply-text-secondary) / <alpha-value>)',
          textMuted: 'rgb(var(--amply-text-muted) / <alpha-value>)',
          accent: 'rgb(var(--amply-accent) / <alpha-value>)',
          accentHover: 'rgb(var(--amply-accent-hover) / <alpha-value>)',
          accentBlue: 'rgb(var(--amply-accent-blue) / <alpha-value>)',
          accentGreen: 'rgb(var(--amply-accent-green) / <alpha-value>)',
          accentPurple: 'rgb(var(--amply-accent-purple) / <alpha-value>)',
        },
      },
      borderRadius: {
        card: '14px',
      },
      fontFamily: {
        sans: ['"ZT Nature"', 'system-ui', 'sans-serif'],
        display: ['"ZT Nature"', 'system-ui', 'sans-serif'],
      },
      spacing: {
        2: '8px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
      },
      boxShadow: {
        card: 'var(--amply-shadow-card)',
        lift: 'var(--amply-shadow-lift)',
        glow: 'var(--amply-shadow-glow)',
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
