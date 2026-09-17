import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Light theme. Every pairing below meets WCAG AA against the
      // surface it is used on — see the contrast note in AGENTS.md.
      colors: {
        // Page and raised surfaces.
        background: '#FFFFFF',
        surface: '#F5F6F8',
        // Primary text. Named ink because it is a text colour, not a
        // tint — it is also the source of every hairline (ink/10) and
        // wash (ink/[0.03]) in the UI.
        ink: '#0C1322',
        // Secondary text. A real token rather than ink/60, so quiet text
        // keeps a guaranteed 5.95:1 instead of drifting with opacity.
        muted: '#5A6478',
        // Links, prices, active states. A CSS variable rather than a fixed
        // hex, because each storefront retints it — see regions/config.ts.
        // <alpha-value> keeps the opacity modifiers working, so
        // text-accent/40 still means what it says.
        accent: 'rgb(var(--accent) / <alpha-value>)',
        /** The default, used before a region has been resolved. */
        'accent-base': '#2F7D00',
        // The brand fill. Only ever a background, always with ink on top
        // (15.4:1). As text on white it would be illegible.
        neon: '#B9FF3C',
      },
      fontFamily: {
        grotesk: ['Anton', 'sans-serif'],
        condiment: ['Condiment', 'cursive'],
        jetbrains: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      boxShadow: {
        // Two-layer shadows: a tight contact shadow plus a soft ambient
        // one. A single large blur reads as fog on a white page.
        card: '0 1px 2px rgba(12, 19, 34, 0.04), 0 8px 24px -12px rgba(12, 19, 34, 0.12)',
        'card-hover': '0 2px 4px rgba(12, 19, 34, 0.06), 0 18px 40px -16px rgba(12, 19, 34, 0.18)',
        pop: '0 4px 8px rgba(12, 19, 34, 0.06), 0 24px 56px -20px rgba(12, 19, 34, 0.22)',
      },
      transitionTimingFunction: {
        // A slightly overshooting ease for anything that "arrives".
        arrive: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-up-in': {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'cart-pop': {
          '0%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(47, 125, 0, 0.35)' },
          '70%': { boxShadow: '0 0 0 12px rgba(47, 125, 0, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(47, 125, 0, 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.5s ease-out both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up-in': 'slide-up-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'cart-pop': 'cart-pop 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.8s infinite',
        marquee: 'marquee 28s linear infinite',
        'pulse-ring': 'pulse-ring 1.4s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config
