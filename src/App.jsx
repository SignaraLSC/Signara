import { lazy, Suspense, useEffect, useState } from 'react'
import LandingScreen from './components/LandingScreen.jsx'
import ModeSelection from './components/ModeSelection.jsx'
import ScreenTransition from './components/ScreenTransition.jsx'
import { setCurrentAvatar } from './utils/signMap.js'
import { warmupMlApi } from './utils/mlApi.js'

const AVATAR_VRM_URL = '/avatar/signara-avatar.vrm'

function preloadAvatarVrm() {
  try {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'fetch'
    link.href = AVATAR_VRM_URL
    link.crossOrigin = 'anonymous'
    if (!document.head.querySelector(`link[href="${AVATAR_VRM_URL}"]`)) {
      document.head.appendChild(link)
    }
  } catch (_) {}
  // También calienta la caché HTTP del navegador.
  fetch(AVATAR_VRM_URL, { mode: 'cors', credentials: 'omit' }).catch(() => {})
}

// Pantallas pesadas cargadas bajo demanda (code-splitting).
// TranslationScreen arrastra Three.js (avatar 3D); InterpretScreen es grande.
// Así el bundle inicial (landing + selección de modo) queda mucho más liviano.
const importTranslation = () => import('./components/TranslationScreen.jsx')
const importInterpret = () => import('./components/InterpretScreen.jsx')
const TranslationScreen = lazy(importTranslation)
const InterpretScreen = lazy(importInterpret)

function ScreenFallback() {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center bg-white"
      style={{
        backgroundImage: 'radial-gradient(rgba(45, 42, 38, 0.07) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-pastel-ink/15 bg-white/90 px-10 py-8 text-pastel-sub">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-pastel-ink/10 border-t-pastel-grape" />
        <span className="text-sm font-semibold">Cargando…</span>
      </div>
    </div>
  )
}

/**
 * App
 * Top-level state machine for the demo screens:
 *
 *   landing  -> mode  -> translate
 *                     -> interpret
 *
 * 'translate'  : entrada texto/voz -> avatar de senas. El avatar se elige
 *                desde un modal en TranslationScreen (Alex / Anuar / Grace).
 * 'interpret'  : camara -> reconocimiento de senas -> texto / audio
 *
 * El avatar elegido se persiste en localStorage. La pantalla activa se refleja
 * en el hash de la URL (#mode, #translate, #interpret) para conservarla al recargar.
 */

const AVATAR_KEY = 'signara:avatarId'
const VALID_IDS = ['alex', 'anuar', 'grace']
const VALID_SCREENS = ['landing', 'mode', 'translate', 'interpret']
const SCREEN_DEPTH = { landing: 0, mode: 1, translate: 2, interpret: 2 }

function motionClassForTransition(from, to) {
  const delta = (SCREEN_DEPTH[to] ?? 0) - (SCREEN_DEPTH[from] ?? 0)
  if (delta > 0) return 'animate-motion-enter-forward'
  if (delta < 0) return 'animate-motion-enter-back'
  return 'animate-motion-fade-through'
}

function readStoredAvatar() {
  try {
    const v = window.localStorage.getItem(AVATAR_KEY)
    if (VALID_IDS.includes(v)) return v
  } catch (_) {}
  return 'alex'
}

function saveStoredAvatar(id) {
  try {
    window.localStorage.setItem(AVATAR_KEY, id)
  } catch (_) {}
}

/** Pantalla actual desde el hash (#mode, #translate, #interpret). */
function screenFromLocation() {
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase()
  if (hash && VALID_SCREENS.includes(hash) && hash !== 'landing') return hash
  return 'landing'
}

function syncLocation(screen) {
  const url = new URL(window.location.href)
  url.hash = screen === 'landing' ? '' : screen
  window.history.replaceState(null, '', url)
}

export default function App() {
  const [screen, setScreen] = useState(screenFromLocation)
  const [avatarId, setAvatarId] = useState('alex')
  const [motionClass, setMotionClass] = useState('animate-motion-enter')

  useEffect(() => {
    const stored = readStoredAvatar()
    setAvatarId(stored)
    setCurrentAvatar(stored)
  }, [])

  useEffect(() => {
    if (screen === 'landing' || screen === 'mode') {
      warmupMlApi()
    }
    // En la selección de modo, precarga chunks + VRM + HandLandmarker para
    // que Traducir/Interpretar no paguen el cold-start al entrar.
    if (screen === 'mode') {
      importTranslation()
      importInterpret()
      preloadAvatarVrm()
      // Dinámico: no meter MediaPipe en el bundle del landing.
      import('./utils/handLandmarker.js').then((m) => m.warmupHandLandmarker())
    }
  }, [screen])

  useEffect(() => {
    const onNavigate = () => {
      const next = screenFromLocation()
      setScreen((current) => {
        if (next !== current) {
          setMotionClass(motionClassForTransition(current, next))
          window.scrollTo(0, 0)
        }
        return next
      })
    }
    window.addEventListener('hashchange', onNavigate)
    window.addEventListener('popstate', onNavigate)
    return () => {
      window.removeEventListener('hashchange', onNavigate)
      window.removeEventListener('popstate', onNavigate)
    }
  }, [])

  const navigate = (next) => {
    if (!VALID_SCREENS.includes(next)) return
    setMotionClass(motionClassForTransition(screen, next))
    syncLocation(next)
    setScreen(next)
    // SPA sin recarga: el navegador conserva el scroll de la pantalla
    // anterior. Si venías desplazado hacia abajo en el Landing (ej. viendo
    // "Funciones") y la pantalla nueva es más corta, aparecías ya scrolleado
    // cerca del final en vez de arriba del todo.
    window.scrollTo(0, 0)
  }

  const handleAvatarChange = (id) => {
    if (!VALID_IDS.includes(id)) return
    setAvatarId(id)
    setCurrentAvatar(id)
    saveStoredAvatar(id)
  }

  return (
    <div className="min-h-screen w-full">
      <ScreenTransition
        screen={screen}
        enterClass={motionClass}
        render={(currentScreen) => {
          if (currentScreen === 'landing') {
            return (
              <LandingScreen
                onStart={() => navigate('mode')}
                onStartTranslate={() => navigate('translate')}
                onStartInterpret={() => navigate('interpret')}
              />
            )
          }
          if (currentScreen === 'mode') {
            return (
              <ModeSelection
                onBack={() => navigate('landing')}
                onSelect={(m) => navigate(m)}
              />
            )
          }
          if (currentScreen === 'translate') {
            return (
              <Suspense fallback={<ScreenFallback />}>
                <TranslationScreen
                  initialMode="text"
                  onBack={() => navigate('mode')}
                  onHome={() => navigate('landing')}
                />
              </Suspense>
            )
          }
          if (currentScreen === 'interpret') {
            return (
              <Suspense fallback={<ScreenFallback />}>
                <InterpretScreen
                  onBack={() => navigate('mode')}
                  onHome={() => navigate('landing')}
                />
              </Suspense>
            )
          }
          return null
        }}
      />
    </div>
  )
}
