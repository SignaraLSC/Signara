/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bridge: {
          purple: '#7060A8',
          iris: '#934CFF',
          blue: '#1F2675',
          yellow: '#FFDE59',
          red: '#FF4D4D',
        },
        signara: {
          blue: '#1F40C2',
          sky: '#9DCDF7',
          navy: '#1F2675',
          purple: '#7060A8',
          lilac: '#B5A3D2',
        },
        palette: {
          pearl: '#EEEDF3',
          surface: '#FFFFFF',
          ink: '#161920',
          iris: '#934CFF',
          azure: '#2E7CF8',
          mist: '#77AAF9',
        },
        pastel: {
          cream: '#F7F3EA',
          ink: '#2D2A26',
          sub: '#6B665E',
          green: '#CDEFC9',
          'green-line': '#94D08E',
          blue: '#D4E6FB',
          'blue-line': '#93BEF0',
          purple: '#E4DAF8',
          'purple-line': '#BCA4E6',
          grape: '#7E64C9',
          yellow: '#FBEFC4',
          'yellow-line': '#E9CF7E',
          pink: '#FF7E92',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Nunito', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'signara-gradient':
          'linear-gradient(135deg, #1F40C2 0%, #1F2675 35%, #7060A8 70%, #B5A3D2 100%)',
        'signara-gradient-soft':
          'linear-gradient(135deg, #9DCDF7 0%, #B5A3D2 100%)',
        'signara-text':
          'linear-gradient(90deg, #1F40C2 0%, #7060A8 100%)',
        halo:
          'linear-gradient(135deg, #934CFF 0%, #2E7CF8 100%)',
        'landing-gradient':
          'linear-gradient(145deg, #934CFF 0%, #7060A8 35%, #1F40C2 70%, #2E7CF8 100%)',
      },
      boxShadow: {
        soft: '0 10px 40px -10px rgba(31, 38, 117, 0.35)',
        glow: '0 0 60px -10px rgba(112, 96, 168, 0.5)',
        halo: '0 8px 32px -4px rgba(147, 76, 255, 0.45)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      transitionTimingFunction: {
        'material-standard': 'cubic-bezier(0.2, 0, 0, 1)',
        'material-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        'material-accelerate': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
        'material-emphasized': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'motion-enter': {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'motion-enter-forward': {
          '0%': { opacity: '0', transform: 'translateX(28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'motion-enter-back': {
          '0%': { opacity: '0', transform: 'translateX(-28px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'motion-scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'motion-modal-in': {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.94)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'motion-modal-backdrop': {
          '0%': { opacity: '0', backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' },
          '100%': { opacity: '1', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' },
        },
        'motion-fade-through': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'motion-slide-up': {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'motion-exit': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(16px) scale(0.98)' },
        },
        'motion-exit-forward': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(-28px)' },
        },
        'motion-exit-back': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(28px)' },
        },
        'motion-exit-fade-through': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.96)' },
        },
        'motion-scale-out': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.92)' },
        },
        'motion-modal-out': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(16px) scale(0.94)' },
        },
        'motion-modal-backdrop-out': {
          '0%': { opacity: '1', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' },
          '100%': { opacity: '0', backdropFilter: 'blur(0px)', WebkitBackdropFilter: 'blur(0px)' },
        },
        'motion-slide-down': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(100%)' },
        },
        'motion-stagger-out': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.25', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(1.05)' },
        },
        'halo-shift': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1) rotate(0deg)' },
          '50%': { opacity: '0.45', transform: 'scale(1.08) rotate(3deg)' },
        },
        'glow-drift-1': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(5%, 8%) scale(1.1)' },
        },
        'glow-drift-2': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(-8%, 5%) scale(1.08)' },
        },
        'glow-drift-3': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(6%, -6%) scale(1.05)' },
        },
        'tutorial-dim-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'tutorial-cutout-pulse': {
          '0%, 100%': {
            boxShadow:
              '0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 0 5px rgba(126, 100, 201, 0.45)',
          },
          '50%': {
            boxShadow:
              '0 0 0 2px rgba(255, 255, 255, 1), 0 0 0 9px rgba(126, 100, 201, 0.62)',
          },
        },
        'tutorial-label-pop': {
          '0%': { opacity: '0', transform: 'translateX(-50%) scale(0.65) translateY(8px)' },
          '65%': { transform: 'translateX(-50%) scale(1.1) translateY(-2px)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) scale(1) translateY(0)' },
        },
        'tutorial-footer-up': {
          '0%': { opacity: '0', transform: 'translateY(28px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'tutorial-header-down': {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'tutorial-emoji-pop': {
          '0%': { opacity: '0', transform: 'scale(0.45) rotate(-10deg)' },
          '65%': { transform: 'scale(1.14) rotate(5deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
        },
        'tutorial-dot-pop': {
          '0%': { transform: 'scale(0.6)' },
          '70%': { transform: 'scale(1.25)' },
          '100%': { transform: 'scale(1)' },
        },
        'permission-overlay-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'permission-card-in': {
          '0%': { opacity: '0', transform: 'scale(0.9) translateY(20px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'permission-item-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'motion-enter 0.55s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-enter': 'motion-enter 0.55s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-enter-forward': 'motion-enter-forward 0.45s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-enter-back': 'motion-enter-back 0.45s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-scale-in': 'motion-scale-in 0.4s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-modal-in': 'motion-modal-in 0.42s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-modal-backdrop': 'motion-modal-backdrop 0.38s cubic-bezier(0.2, 0, 0, 1) both',
        'motion-fade-through': 'motion-fade-through 0.4s cubic-bezier(0.2, 0, 0, 1) both',
        'motion-slide-up': 'motion-slide-up 0.45s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'motion-exit': 'motion-exit 0.32s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-exit-forward': 'motion-exit-forward 0.3s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-exit-back': 'motion-exit-back 0.3s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-exit-fade-through': 'motion-exit-fade-through 0.3s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-scale-out': 'motion-scale-out 0.32s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-modal-out': 'motion-modal-out 0.34s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-modal-backdrop-out': 'motion-modal-backdrop-out 0.32s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-slide-down': 'motion-slide-down 0.34s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'motion-stagger-out': 'motion-stagger-out 0.28s cubic-bezier(0.3, 0, 0.8, 0.15) both',
        'pulse-ring': 'pulse-ring 1.4s cubic-bezier(0.4,0,0.6,1) infinite',
        float: 'float 5s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 4s ease-in-out infinite',
        'halo-shift': 'halo-shift 12s ease-in-out infinite',
        'glow-drift-1': 'glow-drift-1 20s ease-in-out infinite',
        'glow-drift-2': 'glow-drift-2 24s ease-in-out infinite',
        'glow-drift-3': 'glow-drift-3 18s ease-in-out infinite',
        'tutorial-dim-in': 'tutorial-dim-in 0.45s cubic-bezier(0.2, 0, 0, 1) both',
        'tutorial-cutout-pulse': 'tutorial-cutout-pulse 2.2s ease-in-out infinite',
        'tutorial-label-pop': 'tutorial-label-pop 0.5s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'tutorial-footer-up': 'tutorial-footer-up 0.48s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'tutorial-header-down': 'tutorial-header-down 0.42s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'tutorial-emoji-pop': 'tutorial-emoji-pop 0.55s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'tutorial-dot-pop': 'tutorial-dot-pop 0.35s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'permission-overlay-in': 'permission-overlay-in 0.35s cubic-bezier(0.2, 0, 0, 1) both',
        'permission-card-in': 'permission-card-in 0.48s cubic-bezier(0.05, 0.7, 0.1, 1) both',
        'permission-item-in': 'permission-item-in 0.4s cubic-bezier(0.05, 0.7, 0.1, 1) both',
      },
    },
  },
  plugins: [],
}
