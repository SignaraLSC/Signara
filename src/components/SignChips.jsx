import { normalizeSign } from '../utils/signMap.js'

/**
 * SignChips
 * Renders the translated sign sequence as pill-shaped chips. The chip at
 * `activeIndex` is highlighted (so it visually syncs with the avatar).
 */
export default function SignChips({ signs = [], activeIndex = -1 }) {
  if (!signs.length) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {signs.map((sign, i) => (
        <span
          key={`${sign}-${i}`}
          className={
            'chip transition-all duration-300 ' +
            (i === activeIndex
              ? 'chip-active scale-110 ring-4 ring-pastel-grape/30 shadow-[0_8px_24px_-6px_rgba(126,100,201,0.55)]'
              : i < activeIndex
                ? 'opacity-60'
                : '')
          }
        >
          <span className={'text-[10px] font-bold ' + (i === activeIndex ? 'opacity-90' : 'opacity-60')}>
            {i + 1}
          </span>
          {normalizeSign(sign).replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  )
}
