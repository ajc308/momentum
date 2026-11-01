import { useId } from 'react'
import { cn } from '@/lib/utils'

/** The Momentum mark: a forward-leaning volt "M" on a near-black tile. */
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn('h-9 w-9', className)}>
      <defs>
        <linearGradient id={gradientId} x1="10" y1="48" x2="54" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A6D400" />
          <stop offset="1" stopColor="#E6FF8A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0E1013" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="15.5" stroke="rgba(212,255,63,0.25)" />
      <path
        d="M12 46 L22 18 L32 38 L42 18 L52 46"
        stroke={`url(#${gradientId})`}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="skewX(-10) translate(5 0)"
      />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-lg font-bold uppercase italic tracking-[0.08em] text-fg', className)}>
      Momentum
    </span>
  )
}
