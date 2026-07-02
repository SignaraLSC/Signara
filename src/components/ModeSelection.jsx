import { SectionLabel } from './AppShell.jsx'
import {
  AppPage,
  AppPageFooter,
  AppPageHeader,
  AppPageHeading,
  AppPageMain,
  AppPagePanel,
  AppPageStagger,
} from './PageMotion.jsx'

/**
 * ModeSelection — elección entre Traducir e Interpretar.
 */
export default function ModeSelection({ onSelect, onBack }) {
  return (
    <AppPage>
      <AppPageHeader>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border-2 border-pastel-ink/15 bg-white px-4 py-2.5 text-sm font-bold text-pastel-ink transition hover:border-pastel-purple-line hover:bg-pastel-purple/30 focus:outline-none focus:ring-4 focus:ring-pastel-purple motion-press"
          >
            <BackIcon />
            Inicio
          </button>
          <span className="text-xl font-extrabold tracking-tight text-pastel-grape sm:text-2xl">
            Signara
          </span>
          <div className="w-[88px]" aria-hidden="true" />
      </AppPageHeader>

      <AppPageMain>
        <AppPagePanel>
            <div className="mx-auto max-w-2xl animate-motion-enter text-center">
              <SectionLabel color="purple">Paso 1</SectionLabel>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl md:text-[3.4rem]">
                Elige cómo quieres{' '}
                <span className="inline-block rounded-2xl border-2 border-pastel-purple-line bg-pastel-purple px-3 py-0.5 shadow-[0_8px_18px_-8px_rgba(45,42,38,0.35)]">
                  comunicarte
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-lg text-base font-semibold leading-relaxed text-pastel-sub md:text-lg">
                Dos modos, un mismo objetivo: romper la barrera del lenguaje.
              </p>
            </div>

            <AppPageStagger className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
              <ModeCard
                number="01"
                color="green"
                tag="Español → Señas"
                title="Traducir"
                headline="Habla o escribe, el avatar señará por ti"
                description="Convierte texto o voz en lengua de señas con un avatar animado en tiempo real."
                features={['Entrada por texto', 'Micrófono en vivo', 'Avatar personalizable']}
                icon={<TranslateIcon />}
                cta="Empezar a traducir"
                onClick={() => onSelect('translate')}
              />
              <ModeCard
                number="02"
                color="blue"
                tag="Señas → Texto"
                title="Interpretar"
                headline="Muestra tus manos, Signara entiende"
                description="La cámara detecta tus señas y las convierte en texto o voz al instante."
                features={['Reconocimiento con IA', 'Texto al instante', 'Lectura en voz alta']}
                icon={<CameraIcon />}
                cta="Empezar a interpretar"
                onClick={() => onSelect('interpret')}
              />
            </AppPageStagger>

            <AppPageStagger className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 md:mt-12">
              <HintBlock
                color="green"
                title="¿Quieres explicarte a alguien sordo?"
                text="Usa Traducir: tú hablas, el avatar hace las señas."
              />
              <HintBlock
                color="blue"
                title="¿Quieres entender señas?"
                text="Usa Interpretar: señas con la cámara, texto en pantalla."
              />
            </AppPageStagger>
        </AppPagePanel>
      </AppPageMain>

      <AppPageFooter>
        <p className="text-xs text-pastel-sub">Elige un modo para continuar</p>
      </AppPageFooter>
    </AppPage>
  )
}

const CARD_STYLES = {
  green: {
    card: 'border-pastel-green-line bg-pastel-green hover:border-pastel-green-line hover:shadow-[0_28px_50px_-24px_rgba(148,208,142,0.75)]',
    icon: 'border-pastel-green-line bg-white text-pastel-ink',
    tag: 'border-pastel-green-line bg-white text-pastel-ink',
    number: 'border-pastel-green-line text-pastel-ink',
    cta: 'bg-pastel-ink text-white shadow-[0_12px_28px_-10px_rgba(45,42,38,0.55)] hover:bg-pastel-ink/90',
  },
  blue: {
    card: 'border-pastel-blue-line bg-pastel-blue hover:border-pastel-blue-line hover:shadow-[0_28px_50px_-24px_rgba(147,190,240,0.85)]',
    icon: 'border-pastel-blue-line bg-white text-pastel-ink',
    tag: 'border-pastel-blue-line bg-white text-pastel-ink',
    number: 'border-pastel-blue-line text-pastel-ink',
    cta: 'bg-pastel-grape text-white shadow-[0_12px_28px_-10px_rgba(126,100,201,0.7)] hover:brightness-110',
  },
}

function ModeCard({
  number,
  color,
  tag,
  title,
  headline,
  description,
  features,
  icon,
  cta,
  onClick,
}) {
  const s = CARD_STYLES[color]
  return (
    <button
      onClick={onClick}
      className={
        'group motion-surface relative flex min-h-[420px] flex-col overflow-hidden rounded-[2rem] border-[3px] p-7 text-left shadow-[0_20px_44px_-28px_rgba(45,42,38,0.5)] hover:-translate-y-2 focus:outline-none focus:ring-4 focus:ring-pastel-ink/15 md:p-8 ' +
        s.card
      }
    >
      <span
        className={
          'absolute -right-3 -top-4 select-none text-[7rem] font-extrabold leading-none opacity-[0.07] ' +
          (color === 'green' ? 'text-pastel-green-line' : 'text-pastel-blue-line')
        }
        aria-hidden="true"
      >
        {number}
      </span>

      <div className="relative flex items-start justify-between gap-3">
        <span className={'rounded-full border-2 px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-wide ' + s.tag}>
          {tag}
        </span>
        <span
          className={
            'flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.25rem] border-[3px] shadow-[0_10px_24px_-14px_rgba(45,42,38,0.4)] transition duration-300 group-hover:scale-110 group-hover:rotate-3 ' +
            s.icon
          }
        >
          <span className="[&>svg]:h-8 [&>svg]:w-8">{icon}</span>
        </span>
      </div>

      <div className="relative mt-8 flex-1">
        <span className={'inline-flex h-10 w-10 items-center justify-center rounded-xl border-2 bg-[#FAF6EC] text-sm font-extrabold ' + s.number}>
          {number}
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-pastel-ink md:text-[2rem]">
          {title}
        </h2>
        <p className="mt-2 text-base font-bold leading-snug text-pastel-ink/90">
          {headline}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-pastel-ink/70">
          {description}
        </p>

        <ul className="mt-5 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-sm font-bold text-pastel-ink/85">
              <CheckDot color={color} />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <span
        className={
          'relative mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-sm font-extrabold transition group-hover:scale-[1.02] ' +
          s.cta
        }
      >
        {cta}
        <ArrowRightIcon />
      </span>
    </button>
  )
}

function HintBlock({ color, title, text }) {
  const border = color === 'green' ? 'border-pastel-green-line bg-pastel-green/60' : 'border-pastel-blue-line bg-pastel-blue/60'
  return (
    <div className={'motion-surface rounded-2xl border-2 px-5 py-4 ' + border}>
      <p className="text-sm font-extrabold text-pastel-ink">{title}</p>
      <p className="mt-1 text-sm font-semibold text-pastel-ink/70">{text}</p>
    </div>
  )
}

function CheckDot({ color }) {
  const bg = color === 'green' ? 'bg-pastel-green-line' : 'bg-pastel-blue-line'
  return (
    <span className={'flex h-5 w-5 shrink-0 items-center justify-center rounded-full ' + bg}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FAF6EC" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}

function TranslateIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h7M9 3v2c0 4-2.5 7-5 8M5 9c0 2.5 2.5 4.5 5 5.5" />
      <path d="M14 20l3.5-9 3.5 9M15.2 17h4.6" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
