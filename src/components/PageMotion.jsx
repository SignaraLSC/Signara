/**
 * Contenedores reutilizables para entrada/salida Material Motion en todas las pantallas.
 * Al salir de página, motion-exit-host (ScreenTransition) anima estos bloques.
 */

export function AppPage({ children, className = '' }) {
  return (
    <div className={'motion-page landing-page-bg relative min-h-screen font-display text-pastel-ink ' + className}>
      {children}
    </div>
  )
}

export function AppPageHeader({ children }) {
  return (
    <header className="landing-nav-glass">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 md:px-6">
        {children}
      </div>
    </header>
  )
}

export function AppPageMain({ children, className = '' }) {
  return (
    <main className={'relative pt-[4.25rem] md:pt-[4.5rem] ' + className}>
      {children}
    </main>
  )
}

export function AppPagePanel({ children, className = '' }) {
  return (
    <section className="px-4 pb-12 pt-5 sm:px-6 md:pt-7">
      <div className="mx-auto max-w-6xl">
        <div
          className={
            'pastel-panel motion-surface animate-motion-scale-in p-5 sm:p-8 sm:py-9 md:p-10 ' +
            className
          }
        >
          {children}
        </div>
      </div>
    </section>
  )
}

export function AppPageHeading({ children }) {
  return (
    <div className="animate-motion-enter flex flex-col gap-4 border-b-2 border-pastel-ink/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
      {children}
    </div>
  )
}

export function AppPageStagger({ children, className = '', ...rest }) {
  return (
    <div className={'motion-stagger ' + className} {...rest}>
      {children}
    </div>
  )
}

export function AppPageFooter({ children }) {
  return (
    <footer className="relative border-t border-pastel-ink/10 bg-pastel-ink/[0.04] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-6xl text-center">{children}</div>
    </footer>
  )
}
