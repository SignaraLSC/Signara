import Logo from './Logo.jsx'

export default function AppShell({
  onBack,
  backLabel = 'Volver',
  onHome,
  headerRight,
  children,
  footer,
  className = '',
}) {
  return (
    <div className="landing-page-bg relative min-h-screen font-display text-pastel-ink">
      <header className="sticky top-0 z-50 border-b border-pastel-ink/10 bg-pastel-cream/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {onBack && (
              <button
                onClick={onBack}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-pastel-ink/15 bg-white px-3 py-2 text-sm font-bold text-pastel-sub transition hover:text-pastel-ink focus:outline-none focus:ring-4 focus:ring-pastel-purple/30"
              >
                <BackIcon />
                <span className="hidden sm:inline">{backLabel}</span>
              </button>
            )}
          </div>

          {onHome && (
            <button
              onClick={onHome}
              className="flex shrink-0 items-center gap-2 transition hover:opacity-80 focus:outline-none focus:ring-4 focus:ring-pastel-purple/30 rounded-xl"
              title="Inicio"
            >
              <span className="hidden text-xl font-extrabold tracking-tight text-pastel-grape sm:block">
                Signara
              </span>
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl border-2 border-pastel-ink/10 bg-white shadow-[0_8px_20px_-12px_rgba(45,42,38,0.35)]">
                <Logo size={24} />
              </span>
            </button>
          )}

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {headerRight}
          </div>
        </div>
      </header>

      <main className={`mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8 ${className}`}>
        {children}
      </main>

      {footer && (
        <footer className="border-t border-pastel-ink/10 px-6 py-6 text-center">
          <p className="text-xs text-pastel-sub">{footer}</p>
        </footer>
      )}
    </div>
  )
}

export function SectionLabel({ color = 'purple', children }) {
  const colors = {
    green: 'bg-pastel-green border-pastel-green-line',
    blue: 'bg-pastel-blue border-pastel-blue-line',
    yellow: 'bg-pastel-yellow border-pastel-yellow-line',
    purple: 'bg-pastel-purple border-pastel-purple-line',
  }
  return (
    <span
      className={
        'inline-block rounded-full border-2 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-pastel-ink ' +
        (colors[color] || colors.purple)
      }
    >
      {children}
    </span>
  )
}

export function ResetButton({ onClick, label = 'Limpiar' }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-pastel-ink/15 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wide text-pastel-sub transition hover:text-pastel-ink focus:outline-none focus:ring-4 focus:ring-pastel-purple/30 sm:px-4 sm:text-sm sm:normal-case sm:tracking-normal"
      title="Reiniciar todo"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      {label}
    </button>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}
