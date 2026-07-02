import { useEffect, useRef } from 'react'

let poseViewerReady = false
let poseViewerPromise = null

function loadPoseViewerScript() {
  if (poseViewerReady) return Promise.resolve()
  if (poseViewerPromise) return poseViewerPromise

  poseViewerPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-signara-pose-viewer]')) {
      poseViewerReady = true
      resolve()
      return
    }
    const s = document.createElement('script')
    s.type = 'module'
    s.src = '/pose-viewer/esm/pose-viewer.js'
    s.dataset.signaraPoseViewer = 'true'
    s.onload = () => {
      poseViewerReady = true
      resolve()
    }
    s.onerror = () => reject(new Error('no se pudo cargar pose-viewer'))
    document.head.appendChild(s)
  }).catch((err) => {
    poseViewerPromise = null
    throw err
  })

  return poseViewerPromise
}

async function freezeOnLastFrame(viewer) {
  try {
    const pose = await viewer.getPose()
    const fps = pose?.body?.fps || 30
    const lastTime = Math.max(0, viewer.duration - 1 / fps)
    viewer.currentTime = lastTime
    await viewer.pause()
  } catch {
    if (viewer.duration > 0) {
      viewer.currentTime = Math.max(0, viewer.duration - 0.001)
      await viewer.pause()
    }
  }
}

/**
 * Animación 3D de lengua de señas (pose-viewer).
 * El blob URL lo gestiona el padre (TranslationScreen); no revocar aquí
 * (React Strict Mode revocaba antes de que pose-viewer hiciera fetch).
 */
export default function PoseViewer({ src, className = '', onError, onEnded }) {
  const hostRef = useRef(null)
  const viewerRef = useRef(null)
  const onErrorRef = useRef(onError)
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onErrorRef.current = onError
    onEndedRef.current = onEnded
  }, [onError, onEnded])

  useEffect(() => {
    if (!src) return

    let cancelled = false

    loadPoseViewerScript()
      .then(() => {
        if (cancelled || !hostRef.current) return
        hostRef.current.innerHTML = ''
        const viewer = document.createElement('pose-viewer')
        viewer.setAttribute('src', src)
        viewer.setAttribute('autoplay', 'true')
        viewer.setAttribute('loop', 'false')
        viewer.setAttribute('aspect-ratio', '1')
        viewer.setAttribute('width', '100%')
        viewer.style.width = '100%'
        viewer.style.minHeight = '320px'

        const onEndedEvent = () => {
          freezeOnLastFrame(viewer).then(() => {
            if (!cancelled) onEndedRef.current?.()
          })
        }

        viewer.addEventListener('error', (e) => {
          console.warn('[PoseViewer]', e?.detail || e)
          onErrorRef.current?.(e?.detail || new Error('Error al cargar la animación 3D'))
        })
        viewer.addEventListener('ended$', onEndedEvent)

        viewerRef.current = viewer
        hostRef.current.appendChild(viewer)
      })
      .catch((err) => {
        console.warn('[PoseViewer]', err?.message || err)
        onErrorRef.current?.(err)
      })

    return () => {
      cancelled = true
      viewerRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [src])

  if (!src) return null

  return (
    <div
      ref={hostRef}
      className={`relative w-full overflow-hidden rounded-2xl bg-[#FAF6EC] ${className}`}
      aria-label="Animación 3D de lengua de señas"
    />
  )
}
