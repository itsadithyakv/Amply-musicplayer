import type { Config } from 'tailwindcss';

const rgb = (token: string) => `rgb(var(--amply-${token}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        amply: {
          // Neumorphic token set
          bg: rgb('bg'),
          bgDeep: rgb('bg-deep'),
          edge: rgb('edge'),
          textPrimary: rgb('text-primary'),
          textSecondary: rgb('text-secondary'),
          textMuted: rgb('text-muted'),
          accent: rgb('accent'),
          accentHover: rgb('accent-hover'),
          onAccent: rgb('on-accent'),
          danger: rgb('danger'),
          onDanger: rgb('on-danger'),
          success: rgb('success'),
          info: rgb('info'),
          backdrop: rgb('backdrop'),
          // LEGACY aliases — removed at the end of Phase A6 (page migrations).
          bgPrimary: rgb('bg'),
          bgSecondary: rgb('bg-deep'),
          surface: rgb('bg'),
          panel: rgb('bg'),
          card: rgb('bg'),
          hover: rgb('bg-deep'),
          border: rgb('edge'),
          accentBlue: rgb('info'),
          accentGreen: rgb('success'),
          accentPurple: rgb('info'),
        },
      },
      // Replaces Tailwind's default radius scale with the four-step neumorphic scale.
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: '9999px',
      },
      zIndex: {
        raised: '10',
        player: '30',
        shell: '40',
        modal: '50',
        toast: '60',
        feedback: '70',
      },
      fontFamily: {
        sans: ['"ZT Nature"', 'system-ui', 'sans-serif'],
        display: ['"ZT Nature"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        raised: 'var(--neu-raised-shadow)',
        'raised-sm': 'var(--neu-raised-sm-shadow)',
        pressed: 'var(--neu-pressed-shadow)',
        'pressed-sm': 'var(--neu-pressed-sm-shadow)',
        flat: 'var(--neu-flat-shadow)',
        // LEGACY aliases — removed at the end of Phase A6.
        card: 'var(--neu-raised-sm-shadow)',
        lift: 'var(--neu-raised-shadow)',
        glow: '0 0 0 1px rgb(var(--amply-accent) / 0.25)',
      },
      transitionTimingFunction: {
        smooth: 'var(--ease-smooth)',
      },
    },
  },
  plugins: [],
} satisfies Config;
