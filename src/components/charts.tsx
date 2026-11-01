'use client'

import { useId } from 'react'
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import { civilDate } from '@/lib/calendar'
import { formatNumber } from '@/lib/format'

export interface TrendPoint {
  /** Calendar day label, YYYY-MM-DD */
  day: string
  value: number
}

const tooltipStyle = {
  background: '#FFFFFF',
  border: '1px solid #DCE0D5',
  borderRadius: 12,
  color: '#111317',
  fontSize: 12,
  padding: '6px 10px',
}

const dayLabel = (day: string) => format(civilDate(day), 'MMM d')

/**
 * Smoothed area trend for a daily metric. Decorative: callers must also
 * show the key numbers as text.
 */
export function TrendChart({
  data, color, unit, digits = 0, height = 140, showAxis = true, label,
}: {
  data: TrendPoint[]
  color: string
  unit: string
  digits?: number
  height?: number
  showAxis?: boolean
  label: string
}) {
  const gradient = useId()
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            hide={!showAxis}
            tickFormatter={dayLabel}
            tick={{ fill: '#687080', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
          <Tooltip
            cursor={{ stroke: '#C4CABB' }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: '#4A515C' }}
            labelFormatter={label => dayLabel(String(label))}
            formatter={value => [`${formatNumber(Number(value), digits)} ${unit}`, '']}
            separator=""
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.25}
            fill={`url(#${gradient})`}
            dot={false}
            activeDot={{ r: 4, fill: color, stroke: '#FFFFFF', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Daily bars (e.g. steps). */
export function DailyBars({
  data, color, unit, height = 140, label, goal,
}: {
  data: TrendPoint[]
  color: string
  unit: string
  height?: number
  label: string
  goal?: number
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: '#687080', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            cursor={{ fill: 'rgba(17,19,23,0.05)' }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: '#4A515C' }}
            labelFormatter={label => dayLabel(String(label))}
            formatter={value => [`${formatNumber(Number(value))} ${unit}`, '']}
            separator=""
          />
          <Bar
            dataKey="value"
            fill={color}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const p = props as { x: number; y: number; width: number; height: number; value: number }
              const met = goal != null && p.value >= goal
              return <rect x={p.x} y={p.y} width={p.width} height={Math.max(0, p.height)} rx={2} fill={color} opacity={met ? 1 : 0.45} />
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
