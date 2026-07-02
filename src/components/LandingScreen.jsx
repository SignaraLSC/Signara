import { useState } from 'react'

const NAV = [
  { id: 'inicio', label: 'Inicio', href: '#inicio' },
  { id: 'funciones', label: 'Funciones', href: '#funciones' },
  { id: 'como-funciona', label: 'Cómo funciona', href: '#como-funciona' },
]

export default function LandingScreen({ onStart }) {
  const [activeNav, setActiveNav] = useState('inicio')

  return (
    <div className="landing-page-bg motion-page relative min-h-screen font-display text-pastel-ink">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 top-32 h-64 w-64 rounded-full bg-pastel-purple/25 blur-3xl" />
        <div className="absolute -right-20 top-[45%] h-56 w-56 rounded-full bg-pastel-green/20 blur-3xl" />
        <div className="absolute bottom-32 left-1/3 h-48 w-48 rounded-full bg-pastel-blue/20 blur-3xl" />
      </div>

      <header className="landing-nav-glass">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-6">
          <a
            href="#inicio"
            onClick={() => setActiveNav('inicio')}
            className="text-2xl font-extrabold tracking-tight text-pastel-grape"
          >
            Signara
          </a>
          <nav className="hidden items-center gap-6 md:flex" aria-label="Secciones">
            {NAV.map(({ id, label, href }) => (
              <a
                key={id}
                href={href}
                onClick={() => setActiveNav(id)}
                className={
                  'text-sm font-bold transition ' +
                  (activeNav === id
                    ? 'text-pastel-grape underline decoration-pastel-purple-line decoration-2 underline-offset-4'
                    : 'text-pastel-sub hover:text-pastel-ink')
                }
              >
                {label}
              </a>
            ))}
          </nav>
          <button onClick={onStart} className="btn-pastel px-5 py-2.5">
            Probar
          </button>
        </div>
      </header>

      <main className="relative pt-[4.25rem] md:pt-[4.5rem]">
      <section id="inicio" className="scroll-mt-20 px-4 pt-8 md:px-6 md:pt-12">
        <div className="pastel-panel mx-auto max-w-6xl p-6 motion-surface md:p-10">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-10">
            <div className="animate-fade-up">
              <SectionLabel color="purple">Accesibilidad · Lengua de señas</SectionLabel>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
                Comunícate <br className="hidden sm:block" />
                sin <Pill color="purple">barreras</Pill>
              </h1>
              <div className="mt-5 max-w-md space-y-3 text-sm leading-relaxed text-pastel-sub md:text-base">
                <p>
                  Signara traduce tu voz y tu texto a lengua de señas con un avatar, e interpreta
                  señas con la cámara en tiempo real.
                </p>
                <p>Creemos que la comunicación debe ser accesible para todos.</p>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button onClick={onStart} className="btn-pastel-soft px-7 py-4">
                  Empezar ahora
                  <ArrowRightIcon />
                </button>
                <a
                  href="#funciones"
                  className="btn-pastel-ghost hidden sm:inline-flex"
                >
                  Ver funciones
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {['Tiempo real', 'Sin registro', 'En tu navegador'].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 rounded-full border border-pastel-ink/10 bg-white/90 px-3 py-1.5 text-xs font-semibold text-pastel-sub shadow-sm [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-pastel-green-line"
                  >
                    <CheckIcon />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative animate-fade-up [animation-delay:120ms]">
              <SmileySticker className="-top-3 right-0 hidden lg:flex" />
              <div className="mb-5 flex items-center gap-2 text-sm font-bold text-pastel-ink">
                ¿Qué resuelve Signara?
                <ArrowDownIcon />
              </div>
              <CardStack onStart={onStart} />
            </div>
          </div>
        </div>
      </section>

      <SectionSeparator color="purple" />

      {/* ── Impacto ── */}
      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl animate-motion-scale-in text-center">
          <SectionLabel color="purple">El impacto</SectionLabel>
          <p className="mt-6 text-5xl font-extrabold tracking-tight md:text-7xl">
            <span className="gradient-text">+70 millones</span>
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-base font-bold text-pastel-ink md:text-xl">
            de personas en el mundo se comunican con lengua de señas.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-pastel-sub md:text-base">
            La mayoría de quienes oyen no la conocen. Signara construye ese puente entre los dos
            mundos.
          </p>
          <p className="mt-6 text-[11px] uppercase tracking-wider text-pastel-sub/60">
            Fuente: Federación Mundial de Personas Sordas
          </p>
        </div>
      </section>

      <SectionSeparator color="green" />

      {/* ── Funciones ── */}
      <section id="funciones" className="scroll-mt-24 px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <SectionHeading
              align="left"
              label="Funciones"
              labelColor="green"
              title="Todo lo que Signara hace por ti"
              subtitle="Dos formas de comunicarte y un avatar que da vida a cada seña, en tiempo real."
            />
            <SmileySticker className="-top-8 right-0 hidden md:block" />
          </div>

          <div className="motion-stagger mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <FeatureCard
              color="green"
              tag="Voz y texto"
              title="Traducir"
              description="Escribe o habla en español y míralo convertido en señas con un avatar."
              icon={<TranslateIcon />}
              onStart={onStart}
            />
            <FeatureCard
              color="blue"
              tag="Cámara + IA"
              title="Interpretar"
              description="Apunta la cámara a las señas y conviértelas en texto o voz al instante."
              icon={<CameraIcon />}
              onStart={onStart}
            />
            <FeatureCard
              color="purple"
              tag="Animado"
              title="Avatar 3D"
              description="Un avatar realiza las señas con movimientos naturales y fáciles de seguir."
              icon={<AvatarIcon />}
              onStart={onStart}
            />
          </div>
        </div>
      </section>

      <SectionSeparator color="yellow" />

      {/* ── Caso de uso (antes vs con) ── */}
      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            label="El cambio"
            labelColor="yellow"
            title="De la barrera a la conversación"
          />
          <div className="motion-stagger mt-12 grid grid-cols-1 items-stretch gap-6 md:grid-cols-[1fr_auto_1fr] md:gap-5">
            <CompareCard
              variant="before"
              title="Sin Signara"
              items={[
                'Dependes de un intérprete o de escribir notas',
                'Malentendidos y momentos incómodos',
                'La comunicación se vuelve lenta y frustrante',
              ]}
            />
            <div className="hidden items-center justify-center md:flex">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-pastel-purple-line bg-white text-pastel-grape shadow-sm">
                <ArrowRightIcon />
              </span>
            </div>
            <CompareCard
              variant="after"
              title="Con Signara"
              items={[
                'Traduces e interpretas al instante',
                'Te haces entender sin intermediarios',
                'Conversaciones fluidas y naturales',
              ]}
            />
          </div>
        </div>
      </section>

      <SectionSeparator color="blue" />

      {/* ── Por qué Signara ── */}
      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            label="Por qué Signara"
            labelColor="blue"
            title="Hecho para que empieces ya"
          />
          <div className="motion-stagger mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
            <TrustBadge color="purple" icon={<BoltIcon />} title="Tiempo real" description="Traduce e interpreta al instante." />
            <TrustBadge color="green" icon={<CheckIcon />} title="Sin registro" description="Entra y úsalo al momento." />
            <TrustBadge color="blue" icon={<GlobeIcon />} title="En tu navegador" description="Nada que instalar." />
            <TrustBadge color="yellow" icon={<ChatIcon />} title="Ida y vuelta" description="Traduce e interpreta señas." />
          </div>
        </div>
      </section>

      <SectionSeparator color="purple" />

      {/* ── Cómo funciona ── */}
      <section id="como-funciona" className="scroll-mt-24 px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            label="Cómo funciona"
            labelColor="purple"
            title="Empieza en 3 pasos"
          />

          <div className="motion-stagger relative mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div
              className="pointer-events-none absolute left-[18%] right-[18%] top-6 hidden h-px border-t-2 border-dashed border-pastel-ink/12 md:block"
              aria-hidden="true"
            />
            <StepCard color="green" number="01" title="Elige tu modo" description="Traducir o interpretar, según lo que necesites." />
            <StepCard color="blue" number="02" title="Interactúa" description="Escribe, habla o usa la cámara para empezar." />
            <StepCard color="purple" number="03" title="Conecta" description="Comunicación sin barreras con quien quieras." />
          </div>
        </div>
      </section>

      <SectionSeparator color="purple" />

      {/* ── CTA final ── */}
      <section className="px-4 pb-20 md:px-6">
        <div className="relative mx-auto max-w-6xl animate-motion-scale-in overflow-hidden rounded-[2.5rem] border-2 border-pastel-purple-line/50 bg-gradient-to-br from-pastel-purple/70 via-pastel-purple/45 to-pastel-blue/30 px-8 py-16 text-center shadow-[0_24px_50px_-28px_rgba(126,100,201,0.35)] md:px-14 md:py-20">
          <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-white/20 blur-2xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-pastel-grape/15 blur-2xl" aria-hidden="true" />
          <HeartSticker className="left-[10%] top-8 hidden rotate-[-12deg] md:block" />
          <HeartSticker className="bottom-10 right-[12%] hidden rotate-[14deg] md:block" small />
          <h2 className="relative mx-auto max-w-2xl text-3xl font-extrabold leading-tight text-pastel-ink md:text-5xl">
            Empieza a comunicarte sin barreras hoy
          </h2>
          <p className="relative mx-auto mt-5 max-w-md text-sm font-semibold text-pastel-grape md:text-base">
            Sin registro y directo en tu navegador.
          </p>
          <button onClick={onStart} className="btn-pastel relative mt-9 px-9 py-4 text-base">
            Probar Signara
            <ArrowRightIcon />
          </button>
        </div>
      </section>
      </main>

      <footer className="relative px-4 pb-8 pt-6 md:px-6 md:pb-10">
        <div className="mx-auto max-w-6xl">
          <div
            className="h-px bg-gradient-to-r from-transparent via-pastel-ink/10 to-transparent"
            aria-hidden="true"
          />
          <div className="mt-6 flex flex-col items-center justify-between gap-2 sm:flex-row sm:gap-4">
            <p className="text-lg font-extrabold tracking-tight text-pastel-grape sm:text-xl">Signara</p>
            <p className="text-[11px] font-medium text-pastel-sub/60">
              © {new Date().getFullYear()} · Comunicación sin barreras
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ── Pastilla de color del titular ── */
const PILL_COLORS = {
  green: 'bg-pastel-green border-pastel-green-line',
  blue: 'bg-white border-pastel-blue-line',
  purple: 'bg-pastel-purple border-pastel-purple-line',
  yellow: 'bg-pastel-yellow border-pastel-yellow-line',
}

function Pill({ color, children }) {
  return (
    <span
      className={
        'inline-block rounded-2xl border-2 px-4 py-1.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.4)] ' +
        PILL_COLORS[color]
      }
    >
      {children}
    </span>
  )
}

const LABEL_COLORS = {
  green: 'bg-pastel-green border-pastel-green-line',
  blue: 'bg-pastel-blue border-pastel-blue-line',
  yellow: 'bg-pastel-yellow border-pastel-yellow-line',
  purple: 'bg-pastel-purple border-pastel-purple-line',
}

function SectionLabel({ color, children }) {
  return (
    <span
      className={
        'inline-block rounded-full border-2 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-pastel-ink ' +
        LABEL_COLORS[color]
      }
    >
      {children}
    </span>
  )
}

const SEPARATOR_ACCENTS = {
  purple: 'bg-pastel-purple-line/35',
  green: 'bg-pastel-green-line/35',
  yellow: 'bg-pastel-yellow-line/35',
  blue: 'bg-pastel-blue-line/35',
}

function SectionSeparator({ color = 'purple' }) {
  return (
    <div
      className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 md:gap-4 md:px-6"
      aria-hidden="true"
    >
      <div className="h-px flex-1 bg-pastel-ink/8" />
      <div
        className={
          'h-1 w-12 shrink-0 rounded-full md:w-16 ' +
          (SEPARATOR_ACCENTS[color] || SEPARATOR_ACCENTS.purple)
        }
      />
      <div className="h-px flex-1 bg-pastel-ink/8" />
    </div>
  )
}

function SectionHeading({ label, labelColor, title, subtitle, align = 'center' }) {
  const alignClass = align === 'left' ? 'text-left' : 'mx-auto text-center'

  return (
    <div className={'max-w-2xl ' + alignClass}>
      {label && <SectionLabel color={labelColor}>{label}</SectionLabel>}
      <h2 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight md:text-[2.6rem]">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-pastel-sub md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  )
}

/* ── Tarjeta de función (estilo "teacher card" del mosaico) ── */
const CARD_COLORS = {
  green: 'border-pastel-green-line/70 bg-white hover:bg-pastel-green/25',
  blue: 'border-pastel-blue-line/70 bg-white hover:bg-pastel-blue/25',
  purple: 'border-pastel-purple-line/70 bg-white hover:bg-pastel-purple/25',
}

const CARD_TAG_COLORS = {
  green: 'border-pastel-green-line bg-white',
  blue: 'border-pastel-blue-line bg-white',
  purple: 'border-pastel-purple-line bg-white',
}

const CARD_ICON_COLORS = {
  green: 'border-pastel-green-line',
  blue: 'border-pastel-blue-line',
  purple: 'border-pastel-purple-line',
}

function FeatureCard({ color, tag, title, description, icon, onStart }) {
  return (
    <button
      onClick={onStart}
      className={
        'group motion-surface flex h-full flex-col rounded-[1.75rem] border-2 p-7 text-left shadow-[0_12px_28px_-20px_rgba(45,42,38,0.35)] hover:-translate-y-1 hover:shadow-[0_20px_40px_-18px_rgba(45,42,38,0.4)] focus:outline-none focus:ring-4 focus:ring-pastel-ink/10 ' +
        CARD_COLORS[color]
      }
    >
      <div className="flex items-center justify-between">
        <span
          className={
            'rounded-full border-2 px-3 py-1 text-[11px] font-bold text-pastel-ink ' + CARD_TAG_COLORS[color]
          }
        >
          {tag}
        </span>
        <span
          className={
            'flex h-12 w-12 items-center justify-center rounded-2xl border-2 bg-white text-pastel-ink transition group-hover:scale-105 ' +
            CARD_ICON_COLORS[color]
          }
        >
          {icon}
        </span>
      </div>

      <h3 className="mt-8 text-xl font-extrabold text-pastel-ink">{title}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-pastel-sub">{description}</p>

      <span className="mt-6 inline-flex items-center gap-2 self-end">
        <span className="text-sm font-bold text-pastel-ink">Probar</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-pastel-ink/15 bg-white text-pastel-ink transition group-hover:translate-x-0.5">
          <ArrowRightIcon />
        </span>
      </span>
    </button>
  )
}

/* ── Tarjeta de paso (estilo "card stack" del mosaico) ── */
const STEP_BADGE_COLORS = {
  green: 'border-pastel-green-line text-pastel-ink',
  blue: 'border-pastel-blue-line text-pastel-ink',
  purple: 'border-pastel-purple-line text-pastel-grape',
}

function StepCard({ color, number, title, description }) {
  return (
    <div className="motion-surface relative rounded-[1.75rem] border-2 border-pastel-ink/10 bg-white p-7 shadow-[0_12px_28px_-20px_rgba(45,42,38,0.3)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-18px_rgba(45,42,38,0.35)]">
      <span
        className={
          'flex h-12 w-12 items-center justify-center rounded-2xl border-2 bg-pastel-cream text-lg font-extrabold ' +
          STEP_BADGE_COLORS[color]
        }
      >
        {number}
      </span>
      <h3 className="mt-6 text-lg font-extrabold text-pastel-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-pastel-sub">{description}</p>
    </div>
  )
}

/* ── Stickers decorativos ── */
function HeartSticker({ className = '', small = false }) {
  const size = small ? 22 : 30
  return (
    <svg
      className={'pointer-events-none absolute drop-shadow-[0_6px_10px_rgba(45,42,38,0.18)] ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#FF7E92"
      aria-hidden="true"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  )
}

function SmileySticker({ className = '' }) {
  return (
    <span
      className={
        'pointer-events-none absolute flex h-12 w-12 items-center justify-center rounded-full border-2 border-pastel-ink/15 bg-pastel-yellow shadow-[0_6px_14px_-6px_rgba(45,42,38,0.3)] ' +
        className
      }
      aria-hidden="true"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2D2A26" strokeWidth="2" strokeLinecap="round">
        <circle cx="9" cy="10" r="0.6" fill="#2D2A26" />
        <circle cx="15" cy="10" r="0.6" fill="#2D2A26" />
        <path d="M8.5 14c1 1.5 6 1.5 7 0" />
      </svg>
    </span>
  )
}

/* ── Pila de tarjetas con contenido (estilo "Welcome") ── */
const STACK_COLORS = {
  green: { border: 'border-pastel-green-line', box: 'bg-pastel-green/50' },
  blue: { border: 'border-pastel-blue-line', box: 'bg-pastel-blue/50' },
  purple: { border: 'border-pastel-purple-line', box: 'bg-pastel-purple/50' },
}

function ContentCard({ color, number, icon, title, description, onStart, className = '' }) {
  const c = STACK_COLORS[color]
  return (
    <button
      onClick={onStart}
      className={
        'group absolute w-[200px] rounded-[1.75rem] border-2 bg-white p-5 text-left shadow-[0_24px_48px_-28px_rgba(45,42,38,0.5)] transition-all duration-300 ' +
        'hover:z-40 hover:-translate-y-4 hover:rotate-0 hover:scale-[1.05] hover:shadow-[0_34px_60px_-26px_rgba(45,42,38,0.55)] ' +
        'focus-visible:z-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pastel-ink/10 ' +
        c.border +
        ' ' +
        className
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-xl font-extrabold text-pastel-ink">{number}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-pastel-ink/15 bg-white text-pastel-ink opacity-0 transition group-hover:opacity-100 [&>svg]:h-3.5 [&>svg]:w-3.5">
          <ArrowRightIcon />
        </span>
      </div>
      <div className="mt-2 h-0.5 w-full rounded-full bg-pastel-ink/10" />
      <div className="my-5 flex justify-center">
        <span className={'flex h-16 w-16 items-center justify-center rounded-2xl text-pastel-ink [&>svg]:h-9 [&>svg]:w-9 ' + c.box}>
          {icon}
        </span>
      </div>
      <h3 className="text-base font-extrabold text-pastel-ink">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-pastel-sub">{description}</p>
    </button>
  )
}

function CardStack({ onStart }) {
  return (
    <div className="relative mx-auto h-[400px] w-full max-w-[460px]">
      <ContentCard
        color="green"
        number="01"
        icon={<ChatIcon />}
        title="Sin barreras"
        description="Habla con personas sordas aunque no sepas señas."
        onStart={onStart}
        className="left-0 top-8 z-[1] -rotate-[8deg]"
      />
      <ContentCard
        color="blue"
        number="02"
        icon={<BoltIcon />}
        title="Al instante"
        description="Traduce e interpreta en tiempo real, sin intérprete."
        onStart={onStart}
        className="left-1/2 top-0 z-[2] -translate-x-1/2 rotate-0"
      />
      <ContentCard
        color="purple"
        number="03"
        icon={<HeartIcon />}
        title="Para todos"
        description="Comunicación accesible e inclusiva para cualquiera."
        onStart={onStart}
        className="right-0 top-8 z-[3] rotate-[8deg]"
      />
    </div>
  )
}

/* ── Comparativa antes / con Signara ── */
function CompareCard({ variant, title, items }) {
  const before = variant === 'before'
  return (
    <div
      className={
        'rounded-[1.75rem] border-2 p-7 shadow-[0_16px_36px_-26px_rgba(45,42,38,0.4)] ' +
        (before ? 'border-pastel-ink/10 bg-white' : 'border-pastel-green-line/70 bg-pastel-green/25')
      }
    >
      <h3 className="text-lg font-extrabold text-pastel-ink">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-3 text-sm text-pastel-ink/80">
            <span
              className={
                'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full [&>svg]:h-3 [&>svg]:w-3 ' +
                (before ? 'bg-pastel-pink/20 text-pastel-pink' : 'bg-white text-pastel-green-line')
              }
            >
              {before ? <XIcon /> : <CheckIcon />}
            </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}

const TRUST_ICON_BG = {
  purple: 'bg-pastel-purple/50 border-pastel-purple-line/50',
  green: 'bg-pastel-green/50 border-pastel-green-line/50',
  blue: 'bg-pastel-blue/50 border-pastel-blue-line/50',
  yellow: 'bg-pastel-yellow/50 border-pastel-yellow-line/50',
}

/* ── Señal de confianza ── */
function TrustBadge({ color = 'blue', icon, title, description }) {
  return (
    <div className="motion-surface rounded-2xl border-2 border-pastel-ink/10 bg-white p-5 text-center shadow-[0_12px_28px_-22px_rgba(45,42,38,0.35)] hover:-translate-y-0.5">
      <span
        className={
          'mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border text-pastel-ink [&>svg]:h-5 [&>svg]:w-5 ' +
          (TRUST_ICON_BG[color] || TRUST_ICON_BG.blue)
        }
      >
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-extrabold text-pastel-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-pastel-sub">{description}</p>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </svg>
  )
}

/* ── Iconos ── */
function TranslateIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h7M9 3v2c0 4-2.5 7-5 8M5 9c0 2.5 2.5 4.5 5 5.5" />
      <path d="M14 20l3.5-9 3.5 9M15.2 17h4.6" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function AvatarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c0-3.87 3.13-7 7-7s7 3.13 7 7" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M20 9h0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3" opacity="0.5" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.3l-1.3-1.2C5.4 14.4 2 11.3 2 7.6 2 4.9 4.1 3 6.7 3c1.5 0 3 .7 3.9 1.9C11.5 3.7 13 3 14.5 3 17.1 3 19.2 4.9 19.2 7.6c0 3.7-3.4 6.8-8.7 11.5L12 20.3z" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

