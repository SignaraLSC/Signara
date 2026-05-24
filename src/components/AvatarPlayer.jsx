import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AVATARS, normalizeSign, getSignSrc } from '../utils/signMap.js'
import { resolveSign } from '../utils/signPlayer.js'

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
  const [queueLen, setQueueLen] = useState(0)
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
  function refreshQueueLen() {
    setQueueLen(queueRef.current.length)
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
    refreshQueueLen()
    if (queueRef.current.length === 0) {
      setPlaying(false)
      setCurrentLabel(null)
      if (onFinish) onFinish()
      return
    }
    const sign = queueRef.current.shift()
    refreshQueueLen()

    const resolved = resolveSign(sign)

    if (!resolved) {
      setTimeout(playNext, 50)
      return
    }

    setPlaying(true)
    triedFallbackRef.current = false

    if (resolved.type === 'animation') {
      // Modo animación 3D — por ahora reproducir el video local si existe
      const src = getSignSrc(sign)
      if (src) preloadAndSwap(sign, src)
      else setTimeout(playNext, 50)
      return
    }

    preloadAndSwap(sign, resolved.src)
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
    if (!getSignSrc(sign) && !resolveSign(sign)) return  // no video disponible
    queueRef.current.push(sign)
    refreshQueueLen()
    if (!isPlayingRef.current) playNext()
  }

  function clearQueue() {
    queueRef.current = []
    refreshQueueLen()
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
      .filter((s) => Boolean(getSignSrc(s)) || Boolean(resolveSign(s)))
    refreshQueueLen()
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
    setPickerOpen(false)
  }

  return (
    <div className="relative w-full">
      <div className="relative mx-auto aspect-[4/5] max-h-[58vh] w-full max-w-md rounded-4xl overflow-hidden shadow-glow bg-gradient-to-br from-signara-blue/20 via-signara-purple/15 to-signara-lilac/25 backdrop-blur-sm">
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
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full bg-white/90 backdrop-blur text-signara-navy font-bold tracking-wide shadow-soft text-sm">
            {normalizeSign(currentLabel).replace(/_/g, ' ')}
          </div>
        )}

        {/* Avatar name pill - top center, only visible while idle so it
            doesn't overlap the active sign label. */}
        {avatar && !currentLabel && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/90 backdrop-blur text-signara-navy text-xs font-bold tracking-wide shadow-soft">
            {avatar.name}
          </div>
        )}

        {queueLen > 0 && (
          <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-signara-text text-white text-[11px] font-bold shadow-soft">
            +{queueLen} en cola
          </div>
        )}

        {isPlaying && (
          <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur text-white text-[11px] font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
            VIVO
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          className="btn-ghost py-2 px-5 text-sm inline-flex items-center gap-2"
          onClick={() => setPickerOpen(true)}
          title="Personalizar avatar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
          </svg>
          Personalizar
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
          <div className={'relative h-44 w-44 rounded-full bg-gradient-to-br from-signara-blue to-signara-purple shadow-glow flex items-center justify-center ' + (active ? 'animate-float' : '')}>
            <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
 * AvatarPickerModal - lightweight modal listing the available avatars.
 * Tapping one selects it and closes the modal.
 */
function AvatarPickerModal({ avatars, selectedId, onSelect, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-signara-navy/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-3xl bg-white shadow-glow p-6 sm:p-8 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-signara-purple">Personalizar</p>
            <h3 className="mt-1 text-2xl font-extrabold text-signara-navy">Elige tu avatar</h3>
            <p className="mt-1 text-sm text-signara-navy/60">Cambia quien interpreta las senas en pantalla.</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-signara-navy/60 hover:bg-signara-navy/10 hover:text-signara-navy transition"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
          {avatars.map((a) => {
            const selected = a.id === selectedId
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={
                  'group flex flex-col items-center rounded-2xl p-3 sm:p-4 transition focus:outline-none focus:ring-4 focus:ring-signara-purple/20 ' +
                  (selected
                    ? 'bg-signara-lilac/30 ring-2 ring-signara-purple shadow-soft'
                    : 'bg-signara-lilac/10 hover:bg-signara-lilac/20 ring-1 ring-signara-lilac/40')
                }
              >
                <span className="aspect-square w-full rounded-xl overflow-hidden bg-gradient-to-br from-signara-blue/10 via-signara-purple/10 to-signara-lilac/20 flex items-center justify-center">
                  <img
                    src={a.image}
                    alt={a.name}
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                </span>
                <span className={'mt-3 text-sm font-bold ' + (selected ? 'text-signara-purple' : 'text-signara-navy')}>
                  {a.name}
                </span>
                {selected && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-signara-purple">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Activo
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={onClose}
            className="btn-primary py-2.5 px-5 text-sm"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
