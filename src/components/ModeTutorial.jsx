import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMotionExit, MODAL_EXIT_MS } from '../hooks/useMotionExit.js'

const ACCENTS = {
  translate: {
    label: 'Traducir',
    chip: 'bg-pastel-green border-pastel-green-line text-pastel-ink',
    btn: 'bg-pastel-grape',
    bar: 'bg-pastel-green',
  },
  interpret: {
    label: 'Interpretar',
    chip: 'bg-pastel-blue border-pastel-blue-line text-pastel-ink',
    btn: 'bg-pastel-grape',
    bar: 'bg-pastel-blue',
  },
}

const FOOTER_FALLBACK = 220
const HEADER_H = 92
const STEP_MORPH_MS = 480

const STEP_MOTION = 'tutorial-step-motion'
const STEP_MOTION_LIVE = 'tutorial-step-motion--live'

function measureSpot(el, pad = 8) {
  const r = el.getBoundingClientRect()
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  }
}

function viewportBounds(footerHeight = FOOTER_FALLBACK, headerHeight = HEADER_H) {
  const top = headerHeight + 10
  const bottom = window.innerHeight - footerHeight - 10
  return { top, bottom, height: Math.max(0, bottom - top) }
}

function computeScrollDelta(el, footerHeight = FOOTER_FALLBACK) {
  const r = el.getBoundingClientRect()
  const { top, bottom, height: zoneHeight } = viewportBounds(footerHeight)

  if (r.height > zoneHeight) {
    return r.top - top
  }

  if (r.bottom > bottom) {
    return r.bottom - bottom + 6
  }

  if (r.top < top) {
    return r.top - top
  }

  return 0
}

function targetNeedsScroll(el, footerHeight = FOOTER_FALLBACK) {
  return Math.abs(computeScrollDelta(el, footerHeight)) > 2
}

function scrollTargetIntoView(
  el,
  { animate = false, onFrame, footerHeight = FOOTER_FALLBACK } = {},
) {
  const scrollDelta = computeScrollDelta(el, footerHeight)

  if (Math.abs(scrollDelta) > 1) {
    window.scrollBy({
      top: scrollDelta,
      behavior: animate ? 'smooth' : 'auto',
    })
  }

  if (!animate) {
    onFrame?.()
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const start = performance.now()
    let rafId = 0

    const tick = () => {
      onFrame?.()
      if (performance.now() - start < STEP_MORPH_MS) {
        rafId = requestAnimationFrame(tick)
        return
      }
      onFrame?.()
      resolve()
    }

    rafId = requestAnimationFrame(tick)
  })
}

function TutorialCutout({ spot, visible, motionClass, stepIndex }) {
  if (!visible) return null

  if (!spot) {
    return (
      <div
        aria-hidden="true"
        className="tutorial-mobile-dim animate-tutorial-dim-in pointer-events-none fixed inset-0 z-[251]"
      />
    )
  }

  return (
    <>
      <div
        aria-hidden="true"
        className={
          'tutorial-mobile-cutout-hole tutorial-mobile-cutout-hole--enter pointer-events-none fixed z-[251] ' +
          motionClass
        }
        style={{
          top: spot.top,
          left: spot.left,
          width: spot.width,
          height: spot.height,
        }}
      />
      <div
        aria-hidden="true"
        className={
          'tutorial-mobile-cutout-ring tutorial-mobile-cutout-ring--pulse pointer-events-none fixed z-[252] ' +
          motionClass
        }
        style={{
          top: spot.top,
          left: spot.left,
          width: spot.width,
          height: spot.height,
        }}
      />
      <span
        key={stepIndex}
        aria-hidden="true"
        className={
          'tutorial-mobile-cutout-label animate-tutorial-label-pop pointer-events-none fixed z-[253] ' +
          motionClass
        }
        style={{
          top: Math.max(8, spot.top - 30),
          left: spot.left + spot.width / 2,
          transform: 'translateX(-50%)',
        }}
      >
        Aquí
      </span>
    </>
  )
}

function TutorialHeader({ accent, stepIndex, steps, onClose, className = '', animate = false }) {
  const progress = ((stepIndex + 1) / steps.length) * 100

  return (
    <header
      className={
        'tutorial-mobile-header shrink-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 ' +
        (animate ? 'animate-tutorial-header-down ' : '') +
        className
      }
    >
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <span
          className={
            'inline-flex items-center rounded-full border-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ' +
            accent.chip
          }
        >
          Tutorial · {accent.label}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="motion-press rounded-lg px-2 py-1 text-xs font-bold text-pastel-sub transition hover:text-pastel-ink"
        >
          Saltar
        </button>
      </div>

      <div className="mx-auto mt-3 w-full max-w-3xl">
        <p className="text-xs font-bold text-pastel-sub">
          Paso {stepIndex + 1} de {steps.length}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pastel-ink/10">
          <div
            className={
              'h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.05,0.7,0.1,1)] ' +
              accent.bar
            }
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </header>
  )
}

function TutorialNav({ accent, stepIndex, steps, isLast, onPrev, onNext, compact = false }) {
  return (
    <div className={compact ? 'mt-4 space-y-3 sm:mt-5' : 'mt-6 space-y-4'}>
      <div className="flex justify-center gap-1.5">
        {steps.map((_, i) => (
          <span
            key={i}
            className={
              'h-1.5 rounded-full transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] ' +
              (i === stepIndex
                ? 'w-5 animate-tutorial-dot-pop bg-pastel-grape'
                : 'w-1.5 bg-pastel-ink/20')
            }
          />
        ))}
      </div>
      <div className="flex gap-2 sm:justify-end">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="motion-press flex-1 rounded-xl border-2 border-pastel-ink/15 bg-white py-3 text-sm font-bold text-pastel-sub sm:flex-none sm:px-6"
          >
            Atrás
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          className={
            'motion-press rounded-xl py-3 text-sm font-bold text-white sm:min-w-[9rem] ' +
            accent.btn +
            ' ' +
            (stepIndex > 0 ? 'flex-[2] sm:flex-none' : 'flex-1 sm:flex-none sm:px-8')
          }
        >
          {isLast ? 'Empezar' : 'Siguiente'}
        </button>
      </div>
    </div>
  )
}

function TutorialIntro({
  accent,
  step,
  stepIndex,
  steps,
  isLast,
  showMotion,
  closing,
  onClose,
  onPrev,
  onNext,
}) {
  const enterClass = closing ? 'animate-motion-modal-out' : showMotion ? '' : 'opacity-0'

  return (
    <div
      className={
        'tutorial-mobile-intro pointer-events-auto fixed inset-0 z-[250] flex flex-col bg-[#FAF6EC] ' +
        (closing ? 'animate-motion-modal-out' : '')
      }
    >
      <TutorialHeader
        accent={accent}
        stepIndex={stepIndex}
        steps={steps}
        onClose={onClose}
        animate={showMotion && !closing}
      />

      <main
        className={
          'flex flex-1 flex-col items-center justify-center px-6 text-center sm:px-10 ' + enterClass
        }
      >
        <div className="tutorial-stagger flex flex-col items-center">
          <span className="text-6xl leading-none sm:text-7xl" aria-hidden="true">
            {step.emoji}
          </span>
          <h2
            id="mode-tutorial-title"
            className="mt-5 max-w-lg text-2xl font-extrabold tracking-tight text-pastel-ink sm:text-3xl"
          >
            {step.title}
          </h2>
          <p className="mt-3 max-w-md text-base leading-relaxed text-pastel-sub sm:text-lg">
            {step.body}
          </p>
        </div>
      </main>

      <footer className="tutorial-mobile-footer animate-tutorial-footer-up shrink-0 px-4 pt-2 sm:px-8">
        <div className="mx-auto max-w-lg">
          <TutorialNav
            accent={accent}
            stepIndex={stepIndex}
            steps={steps}
            isLast={isLast}
            onPrev={onPrev}
            onNext={onNext}
          />
        </div>
      </footer>
    </div>
  )
}

function TutorialCoach({
  accent,
  step,
  stepIndex,
  steps,
  isLast,
  spot,
  showMotion,
  stepMotionClass,
  closing,
  footerRef,
  stepDir,
  onClose,
  onPrev,
  onNext,
}) {
  const stepEnterClass =
    stepDir > 0 ? 'animate-motion-enter-forward' : 'animate-motion-enter-back'

  return (
    <div className="pointer-events-none fixed inset-0 z-[250]">
      <TutorialCutout
        spot={spot}
        visible={showMotion}
        motionClass={stepMotionClass}
        stepIndex={stepIndex}
      />

      <div className="flex h-full flex-col">
        <TutorialHeader
          accent={accent}
          stepIndex={stepIndex}
          steps={steps}
          onClose={onClose}
          animate={showMotion && !closing}
          className="pointer-events-auto relative z-[260]"
        />

        <div className="flex-1" aria-hidden="true" />

        <footer
          ref={footerRef}
          className={
            'tutorial-mobile-footer animate-tutorial-footer-up pointer-events-auto relative z-[260] shrink-0 px-4 pt-3 sm:px-8 sm:pt-4 ' +
            (closing ? 'animate-motion-slide-down' : '')
          }
        >
          <div key={stepIndex} className={'mx-auto max-w-2xl ' + stepEnterClass}>
            <div className="flex items-start gap-3 sm:gap-4">
              <span
                className="animate-tutorial-emoji-pop text-2xl leading-none sm:text-3xl"
                aria-hidden="true"
              >
                {step.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  id="mode-tutorial-title"
                  className="text-lg font-extrabold leading-snug text-pastel-ink sm:text-xl"
                >
                  {step.title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-pastel-sub sm:text-base">
                  {step.body}
                </p>
              </div>
            </div>

            <TutorialNav
              accent={accent}
              stepIndex={stepIndex}
              steps={steps}
              isLast={isLast}
              onPrev={onPrev}
              onNext={onNext}
              compact
            />
          </div>
        </footer>
      </div>
    </div>
  )
}

export function TutorialHelpButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="motion-press inline-flex h-9 w-9 shrink-0 animate-pulse-soft items-center justify-center rounded-full border-2 border-pastel-purple-line bg-pastel-purple text-sm font-extrabold text-pastel-grape transition hover:brightness-105 focus:outline-none focus:ring-4 focus:ring-pastel-purple/40"
      aria-label="Ver tutorial de este modo"
      title="Tutorial"
    >
      ?
    </button>
  )
}

export default function ModeTutorial({ mode, steps, open, onComplete }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [entered, setEntered] = useState(false)
  const [spot, setSpot] = useState(null)
  const [stepAnimReady, setStepAnimReady] = useState(false)
  const [spotLive, setSpotLive] = useState(false)
  const [footerHeight, setFooterHeight] = useState(FOOTER_FALLBACK)
  const [stepDir, setStepDir] = useState(1)
  const footerRef = useRef(null)
  const stepAnimReadyRef = useRef(false)
  const { closing, requestClose } = useMotionExit(onComplete, MODAL_EXIT_MS)

  const accent = ACCENTS[mode] || ACCENTS.translate
  const step = steps[stepIndex]
  const isLast = stepIndex >= steps.length - 1
  const showMotion = entered && !closing
  const isIntro = !step?.target
  const isCoach = !!step?.target

  useLayoutEffect(() => {
    if (!open || !isCoach || !footerRef.current) return

    const measure = () => {
      const h = footerRef.current?.offsetHeight
      if (h && h > 0) setFooterHeight(h)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(footerRef.current)
    return () => ro.disconnect()
  }, [open, isCoach, stepIndex, step?.title])

  useEffect(() => {
    if (!open) {
      setStepIndex(0)
      setEntered(false)
      setSpot(null)
      setStepAnimReady(false)
      setSpotLive(false)
      setFooterHeight(FOOTER_FALLBACK)
      setStepDir(1)
      stepAnimReadyRef.current = false
      return
    }

    let raf2
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })

    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [open])

  useEffect(() => {
    if (!open || !step?.target) {
      setSpot(null)
      setStepAnimReady(!step?.target)
      return
    }

    let cancelled = false
    let rafId = 0
    const targetEl = document.querySelector(`[data-tutorial="${step.target}"]`)

    if (!targetEl) {
      setSpot(null)
      setStepAnimReady(true)
      return
    }

    const updateSpot = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        if (!cancelled) setSpot(measureSpot(targetEl))
      })
    }

    const alignTarget = async () => {
      const animateScroll =
        stepIndex > 0 &&
        stepAnimReadyRef.current &&
        targetNeedsScroll(targetEl, footerHeight)

      if (animateScroll) {
        setSpotLive(true)
        await scrollTargetIntoView(targetEl, {
          animate: true,
          footerHeight,
          onFrame: updateSpot,
        })
        if (!cancelled) setSpotLive(false)
      } else {
        await scrollTargetIntoView(targetEl, {
          animate: false,
          footerHeight,
          onFrame: updateSpot,
        })
      }

      if (cancelled) return

      stepAnimReadyRef.current = true
      window.setTimeout(() => {
        if (!cancelled) setStepAnimReady(true)
      }, 50)
    }

    alignTarget()

    window.addEventListener('scroll', updateSpot, { passive: true })
    window.addEventListener('resize', updateSpot)
    const resizeObserver = new ResizeObserver(updateSpot)
    resizeObserver.observe(targetEl)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', updateSpot)
      window.removeEventListener('resize', updateSpot)
      resizeObserver.disconnect()
    }
  }, [open, stepIndex, step?.target, footerHeight])

  if (!open) return null

  function closeTutorial() {
    requestClose()
  }

  function nextStep() {
    setStepDir(1)
    if (isLast) {
      closeTutorial()
      return
    }
    setStepIndex((i) => i + 1)
  }

  function prevStep() {
    setStepDir(-1)
    setStepIndex((i) => Math.max(0, i - 1))
  }

  const stepMotionClass = spotLive
    ? STEP_MOTION + ' ' + STEP_MOTION_LIVE
    : stepAnimReady
      ? STEP_MOTION
      : ''

  const sharedProps = {
    accent,
    step,
    stepIndex,
    steps,
    isLast,
    showMotion,
    closing,
    onClose: closeTutorial,
    onPrev: prevStep,
    onNext: nextStep,
  }

  return createPortal(
    <div
      className={closing ? 'motion-exit-host' : ''}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mode-tutorial-title"
    >
      {isIntro ? (
        <TutorialIntro {...sharedProps} />
      ) : (
        <TutorialCoach
          {...sharedProps}
          spot={spot}
          stepMotionClass={stepMotionClass}
          footerRef={footerRef}
          stepDir={stepDir}
        />
      )}
    </div>,
    document.body,
  )
}
