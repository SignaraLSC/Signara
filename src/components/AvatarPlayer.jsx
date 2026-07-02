import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMotionExit } from '../hooks/useMotionExit.js'
import { AVATARS, normalizeSign, getSignSrc } from '../utils/signMap.js'

/**
 * AvatarPlayer
 *
 * Queue-based sign-language video player with DOUBLE-BUFFERED video.
 *
 * Two <video> elements are stacked (A and B). At any moment one is "active"
 * (visible, opacity 1) and the other is "buffered" (hidden, opacity 0).
 *
 *   playNext() -> picks the next sign, loads its mp4 into the BUFFER element,
 *                 waits for `canplay`, then plays it AND crossfades the
 *                 active/buffer opacities. After the swap, the previous
 *                 active element becomes the new buffer for the sign after.
 *
 * The character itself is selected via the `avatarId` prop. Below the video
 * we render a "Personalizar" button that opens a small modal listing the
 * available avatars (Alex / Anuar / Grace). Picking one fires
 * `onAvatarChange(id)` so the parent can update its state and the module
 * level signMap pointer.
 *
 * Public API (forwardRef):
 *   queue(sign), replace(signs), clear(), isPlaying(), queueLength()
 */
const AvatarPlayer = forwardRef(function AvatarPlayer(
  { signs = [], avatarId = 'alex', onAvatarChange, onSign, onFinish },
  ref
) {
  // Two persistent <video> elements
  const videoARef = useRef(null)
  const videoBRef = useRef(null)
  // Which one is currently visible: 'A' or 'B'
  const activeRef = useRef('A')

  // Queue logic
  const queueRef = useRef([])
  const isPlayingRef = useRef(false)
  const lastSignsRef = useRef([])

  // Per-sign retry guard for the underscore<->space filename fallback
  const triedFallbackRef = useRef(false)

  // UI state
  const [currentLabel, setCurrentLabel] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasShownAny, setHasShownAny] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const avatar = AVATARS.find((a) => a.id === avatarId) || AVATARS[0]

  // -------- helpers --------------------------------------------------------
  function getActiveVideo() {
    return activeRef.current === 'A' ? videoARef.current : videoBRef.current
  }
  function getNextVideo() {
    return activeRef.current === 'A' ? videoBRef.current : videoARef.current
  }
  function toggleActive() {
    activeRef.current = activeRef.current === 'A' ? 'B' : 'A'
  }
  function setPlaying(v) {
    isPlayingRef.current = v
    setIsPlaying(v)
  }
  function altUrl(src) {
    if (!src) return null
    if (src.includes('%20')) return src.replace(/%20/g, '_')
    if (src.includes(' '))   return src.replace(/ /g, '_')
    if (src.includes('_'))   return src.replace(/_/g, '%20')
    return null
  }
  function clearVideoListeners(v) {
    if (!v) return
    v.oncanplay = null
    v.onerror = null
  }

  // -------- core playback --------------------------------------------------
  function playNext() {
    if (queueRef.current.length === 0) {
      setPlaying(false)
      setCurrentLabel(null)
      if (onFinish) onFinish()
      return
    }
    const sign = queueRef.current.shift()

    const src = getSignSrc(sign)
    if (!src) {
      setTimeout(playNext, 50)
      return
    }

    setPlaying(true)
    triedFallbackRef.current = false
    preloadAndSwap(sign, src)
  }

  /**
   * Load `src` into the inactive (buffer) <video>, wait for canplay, then
   * play() it and crossfade opacities to swap which one is visible.
   */
  function preloadAndSwap(sign, src) {
    const next = getNextVideo()
    const active = getActiveVideo()
    if (!next) return

    console.log('Preloading:', src)

    // Clean up any prior listeners on the buffer to avoid leaks / double-fires
    clearVideoListeners(next)

    next.muted = true
    next.playsInline = true
    next.preload = 'auto'

    next.oncanplay = async () => {
      // One-shot: detach so a buffered sign that becomes ready later
      // doesn't accidentally re-fire.
      clearVideoListeners(next)
      console.log('Switching video to:', sign)

      try {
        await next.play()
      } catch (err) {
        console.warn('play() rejected for', sign, err)
      }

      // Crossfade
      next.style.opacity = '1'
      if (active && active !== next) {
        active.style.opacity = '0'
        try { active.pause() } catch (_) {}
      }

      toggleActive()
      setCurrentLabel(sign)
      setHasShownAny(true)
      if (onSign) onSign(sign)
    }

    next.onerror = () => {
      // Try the underscore<->space variant once before skipping
      if (!triedFallbackRef.current) {
        const alt = altUrl(src)
        if (alt && alt !== src) {
          console.warn('Preload error, retrying with alt URL:', alt)
          triedFallbackRef.current = true
          preloadAndSwap(sign, alt)
          return
        }
      }
      console.warn('Preload error for', sign, '- skipping')
      clearVideoListeners(next)
      setTimeout(playNext, 100)
    }

    next.src = src
    next.load()
  }

  // Fired when EITHER video reaches the natural end. Only react if it was
  // the active one (the buffered one shouldn't be playing).
  function handleVideoEnded(e) {
    if (!isPlayingRef.current) return
    const which = e.target === videoARef.current ? 'A' : 'B'
    if (which !== activeRef.current) return  // ignore the (paused) buffer
    console.log('Video ended:', currentLabel)
    playNext()
  }

  // -------- imperative API -------------------------------------------------
  function queueAnimation(rawSign) {
    if (!rawSign) return
    const sign = normalizeSign(rawSign)
    if (!getSignSrc(sign)) return
    queueRef.current.push(sign)
    if (!isPlayingRef.current) playNext()
  }

  function clearQueue() {
    queueRef.current = []
    setPlaying(false)
    setCurrentLabel(null)
    // Hide both videos, pause both
    for (const v of [videoARef.current, videoBRef.current]) {
      if (!v) continue
      try { v.pause() } catch (_) {}
      v.style.opacity = '0'
      clearVideoListeners(v)
    }
    setHasShownAny(false)
  }

  function replaceQueue(newSigns) {
    queueRef.current = (newSigns || [])
      .map(normalizeSign)
      .filter((s) => Boolean(getSignSrc(s)))
    setPlaying(false)
    setCurrentLabel(null)
    if (queueRef.current.length > 0) playNext()
  }

  useImperativeHandle(ref, () => ({
    queue: queueAnimation,
    clear: clearQueue,
    replace: replaceQueue,
    isPlaying: () => isPlayingRef.current,
    queueLength: () => queueRef.current.length
  }))

  // Backward-compat: when `signs` prop changes (typed-text flow), replace queue.
  useEffect(() => {
    if (!signs) return
    if (signs === lastSignsRef.current) return
    const sameLength = signs.length === lastSignsRef.current.length
    const same = sameLength && signs.every((s, i) => s === lastSignsRef.current[i])
    if (same) return
    lastSignsRef.current = signs
    if (signs.length > 0) replaceQueue(signs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signs])

  // When the active avatar changes, reset playback so the next clip comes
  // from the new folder and the idle frame shows the new character.
  useEffect(() => {
    clearQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId])

  // On unmount: clean listeners
  useEffect(() => {
    return () => {
      clearVideoListeners(videoARef.current)
      clearVideoListeners(videoBRef.current)
    }
  }, [])

  function handleSelectAvatar(id) {
    if (onAvatarChange) onAvatarChange(id)
  }

  return (
    <div className="relative w-full">
      <div
        data-tutorial="translate-avatar"
        className="relative mx-auto aspect-[4/5] max-h-[58vh] w-full max-w-md overflow-hidden rounded-[1.75rem] border-2 border-pastel-ink/10 bg-white shadow-[0_16px_36px_-22px_rgba(45,42,38,0.45)]"
      >
        {/* DOUBLE-BUFFER: two stacked <video> elements that crossfade.
            Initial inline opacity 0; we drive opacity imperatively from
            preloadAndSwap() so React never re-applies stale styles. */}
        <video
          ref={videoARef}
          muted
          playsInline
          preload="auto"
          onEnded={handleVideoEnded}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out"
          style={{ opacity: 0 }}
        />
        <video
          ref={videoBRef}
          muted
          playsInline
          preload="auto"
          onEnded={handleVideoEnded}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out"
          style={{ opacity: 0 }}
        />

        {/* Idle / fallback avatar - underneath the videos. Hidden once we've
            successfully crossfaded any clip in. Uses the currently selected
            avatar's image so the user sees who will sign for them. */}
        {!hasShownAny && <FallbackAvatar avatar={avatar} active={isPlaying} />}

        {/* Sign label */}
        {currentLabel && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border-2 border-pastel-purple-line bg-white/95 px-5 py-2 text-sm font-bold tracking-wide text-pastel-ink shadow-[0_8px_20px_-12px_rgba(45,42,38,0.35)] backdrop-blur">
            {normalizeSign(currentLabel).replace(/_/g, ' ')}
          </div>
        )}

        {avatar && !currentLabel && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border-2 border-pastel-ink/10 bg-white/95 px-3 py-1 text-xs font-bold tracking-wide text-pastel-ink shadow-[0_8px_20px_-12px_rgba(45,42,38,0.35)] backdrop-blur">
            {avatar.name}
          </div>
        )}

        {isPlaying && (
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur text-white text-[11px] font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            VIVO
          </div>
        )}
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          data-tutorial="translate-picker"
          className="group flex w-full items-center gap-3 rounded-2xl border-[3px] border-pastel-green-line bg-pastel-green/50 px-4 py-3 text-left shadow-[0_10px_24px_-14px_rgba(45,42,38,0.3)] transition hover:border-pastel-grape hover:bg-pastel-green focus:outline-none focus:ring-4 focus:ring-pastel-purple/30 sm:px-5 sm:py-3.5"
          title="Elegir intérprete"
        >
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-white bg-white shadow-sm">
            <img
              src={avatar.image}
              alt={avatar.name}
              className="h-full w-full object-contain p-1 transition group-hover:scale-105"
              draggable={false}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-pastel-grape">
              Tu intérprete
            </span>
            <span className="block truncate text-lg font-extrabold text-pastel-ink">{avatar.name}</span>
            <span className="block text-xs font-semibold text-pastel-sub">Toca para cambiar de avatar</span>
          </span>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-pastel-ink/10 bg-white text-pastel-grape transition group-hover:border-pastel-purple-line group-hover:bg-pastel-purple">
            <ChevronIcon />
          </span>
        </button>
      </div>

      {pickerOpen && (
        <AvatarPickerModal
          avatars={AVATARS}
          selectedId={avatar?.id}
          onSelect={handleSelectAvatar}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
})

export default AvatarPlayer

function FallbackAvatar({ avatar, active }) {
  const [imgFailed, setImgFailed] = useState(false)
  const src = avatar?.image || '/avatar.png'
  const alt = avatar ? `Avatar ${avatar.name}` : 'Avatar Signara'

  // Reset the failed flag whenever the avatar source changes so a successful
  // image after a failed one re-renders correctly.
  useEffect(() => {
    setImgFailed(false)
  }, [src])

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <div className="relative flex items-center justify-center">
        {!imgFailed ? (
          <img
            src={src}
            alt={alt}
            onError={() => setImgFailed(true)}
            className={'relative h-72 w-72 sm:h-80 sm:w-80 object-contain drop-shadow-2xl ' + (active ? 'animate-float' : '')}
            draggable={false}
          />
        ) : (
          <div className={'relative flex h-44 w-44 items-center justify-center rounded-full border-2 border-pastel-purple-line bg-pastel-purple/50 shadow-[0_16px_36px_-22px_rgba(45,42,38,0.4)] ' + (active ? 'animate-float' : '')}>
            <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#7E64C9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11V5a1.5 1.5 0 1 1 3 0v5" />
              <path d="M12 10V4a1.5 1.5 0 1 1 3 0v6" />
              <path d="M15 10V6a1.5 1.5 0 1 1 3 0v6" />
              <path d="M9 11V8a1.5 1.5 0 0 0-3 0v6c0 3.3 2.7 6 6 6h1a6 6 0 0 0 6-6v-2" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * AvatarPickerModal — elige quién interpreta las señas.
 */
const AVATAR_META = {
  alex: {
    tag: 'Principal',
    color: 'purple',
    desc: 'Equilibrado y versátil. Ideal para empezar.',
  },
  anuar: {
    tag: 'Masculino',
    color: 'blue',
    desc: 'Intérprete con apariencia y gestos masculinos.',
  },
  grace: {
    tag: 'Femenino',
    color: 'green',
    desc: 'Intérprete con apariencia y gestos femeninos.',
  },
}

const AVATAR_CARD_STYLES = {
  purple: {
    card: 'border-pastel-purple-line bg-pastel-purple/40',
    tag: 'border-pastel-purple-line bg-white',
    ring: 'ring-pastel-grape',
  },
  blue: {
    card: 'border-pastel-blue-line bg-pastel-blue/40',
    tag: 'border-pastel-blue-line bg-white',
    ring: 'ring-pastel-blue-line',
  },
  green: {
    card: 'border-pastel-green-line bg-pastel-green/40',
    tag: 'border-pastel-green-line bg-white',
    ring: 'ring-pastel-green-line',
  },
}

function AvatarPickerModal({ avatars, selectedId, onSelect, onClose }) {
  const [previewId, setPreviewId] = useState(selectedId)
  const [entered, setEntered] = useState(false)
  const preview = avatars.find((a) => a.id === previewId) || avatars[0]
  const meta = AVATAR_META[previewId] || AVATAR_META.alex
  const styles = AVATAR_CARD_STYLES[meta.color] || AVATAR_CARD_STYLES.purple
  const { closing, requestClose } = useMotionExit(onClose)

  useEffect(() => {
    let raf2
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [requestClose])

  function confirmSelection() {
    if (previewId === selectedId) {
      requestClose()
      return
    }
    requestClose(() => onSelect(previewId))
  }

  const showMotion = entered && !closing

  return createPortal(
    <div
      className={
        'fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4 ' +
        (closing ? 'motion-exit-host' : '')
      }
      onClick={() => requestClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
    >
      <div
        className={
          'modal-backdrop-glass absolute inset-0 ' +
          (closing
            ? 'animate-motion-modal-backdrop-out'
            : showMotion
              ? 'animate-motion-modal-backdrop'
              : 'opacity-0')
        }
        aria-hidden="true"
      />

      <div
        className={
          'relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[2rem] border-2 border-pastel-ink/10 bg-[#FAF6EC] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55)] sm:rounded-[2rem] ' +
          (closing
            ? 'animate-motion-slide-down sm:animate-motion-modal-out'
            : showMotion
              ? 'animate-motion-slide-up sm:animate-motion-modal-in'
              : 'translate-y-8 scale-[0.96] opacity-0 sm:translate-y-6')
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={
            'border-b-2 border-pastel-ink/10 px-5 py-6 sm:px-8 ' +
            styles.card +
            (showMotion ? ' animate-motion-enter' : '')
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-pastel-grape">
                Personalizar
              </p>
              <h3 id="avatar-picker-title" className="mt-1 text-2xl font-extrabold text-pastel-ink sm:text-3xl">
                Elige tu intérprete
              </h3>
            </div>
            <button
              onClick={() => requestClose()}
              className="motion-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-pastel-ink/10 bg-white text-pastel-sub transition hover:border-pastel-purple-line hover:text-pastel-ink"
              aria-label="Cerrar"
            >
              <CloseIcon />
            </button>
          </div>

          <div
            key={previewId}
            className={
              'mt-5 flex items-center gap-4 rounded-2xl border-2 border-white/70 bg-white/80 p-4 shadow-sm ' +
              (showMotion ? 'animate-motion-fade-through' : '')
            }
          >
            <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-pastel-ink/10 bg-white sm:h-28 sm:w-28">
              <img
                src={preview.image}
                alt={preview.name}
                className="h-full w-full object-contain p-2"
                draggable={false}
              />
            </span>
            <div className="min-w-0 flex-1">
              <span className={'inline-block rounded-full border-2 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ' + styles.tag}>
                {meta.tag}
              </span>
              <p className="mt-2 text-2xl font-extrabold text-pastel-ink">{preview.name}</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-pastel-sub">{meta.desc}</p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-8">
          <p className="mb-3 text-xs font-extrabold uppercase tracking-wider text-pastel-grape">
            Todos los intérpretes
          </p>
          <div className={showMotion ? 'motion-stagger space-y-3' : 'space-y-3'}>
            {avatars.map((a) => {
              const m = AVATAR_META[a.id] || AVATAR_META.alex
              const s = AVATAR_CARD_STYLES[m.color] || AVATAR_CARD_STYLES.purple
              const isPreview = a.id === previewId
              const isActive = a.id === selectedId

              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setPreviewId(a.id)}
                  className={
                    'motion-surface flex w-full items-center gap-3 rounded-2xl border-[3px] p-3 text-left focus:outline-none sm:gap-4 sm:p-4 ' +
                    (isPreview
                      ? s.card + ' shadow-[0_12px_28px_-14px_rgba(45,42,38,0.35)] ring-4 ring-offset-2 ' + s.ring
                      : 'border-pastel-ink/10 bg-white hover:border-pastel-purple-line hover:bg-pastel-purple/20')
                  }
                >
                  <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-pastel-ink/10 bg-white sm:h-20 sm:w-20">
                    <img src={a.image} alt={a.name} className="h-full w-full object-contain p-1.5" draggable={false} />
                    {isActive && (
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-pastel-grape text-white shadow-md">
                        <CheckIcon />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold text-pastel-ink sm:text-lg">{a.name}</span>
                      <span className={'rounded-full border px-2 py-0.5 text-[10px] font-bold ' + s.tag}>{m.tag}</span>
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold text-pastel-sub sm:text-sm">{m.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div
          className={
            'flex gap-3 border-t-2 border-pastel-ink/10 bg-white/60 px-5 py-4 sm:px-8 ' +
            (showMotion ? 'animate-motion-enter [animation-delay:180ms]' : '')
          }
        >
          <button
            type="button"
            onClick={() => requestClose()}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border-2 border-pastel-ink/15 bg-white text-sm font-bold text-pastel-sub transition hover:text-pastel-ink motion-press sm:flex-none sm:px-5"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmSelection}
            disabled={previewId === selectedId}
            className="motion-press inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-pastel-grape px-5 text-sm font-bold text-white shadow-[0_8px_20px_-6px_rgba(126,100,201,0.6)] transition hover:brightness-110 disabled:cursor-default disabled:opacity-50 sm:flex-1"
          >
            {previewId === selectedId ? (
              'Ya está activo'
            ) : (
              <>
                Usar a {preview.name}
                <ArrowIcon />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}
