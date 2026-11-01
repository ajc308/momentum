import { z } from 'zod'
import prisma from '@/lib/prisma'
import { parseWorkoutDate } from '@/lib/workout-date'
import { navyBodyFatPct } from '@/lib/body-fat'

export { navyBodyFatPct }

/** Shared validation for manual weigh-ins (REST route and MCP tool). */
export const weightEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => parseWorkoutDate(v) != null, 'Invalid date')
    .describe('Calendar date of the weigh-in, YYYY-MM-DD.'),
  weightLbs: z.number().min(50).max(1000).describe('Body weight in pounds.'),
  bodyFatPct: z.number().min(1).max(75).optional()
    .describe('Body fat percentage, if known. Ignored when neck and waist are given (it is then calculated).'),
  neckIn: z.number().min(8).max(30).optional().describe('Neck circumference in inches, just below the Adam\'s apple.'),
  waistIn: z.number().min(20).max(80).optional().describe('Waist circumference in inches, at the navel.'),
  heightIn: z.number().min(48).max(96).optional()
    .describe('Height in inches. Defaults to the last height logged.'),
})

export type WeightEntry = z.infer<typeof weightEntrySchema>

/** One row per calendar day: logging again for the same day replaces it. */
export async function logWeight({ date, weightLbs, bodyFatPct, neckIn, waistIn, heightIn }: WeightEntry) {
  const day = new Date(`${date}T00:00:00Z`)
  let height = heightIn
  if (height == null && neckIn != null && waistIn != null) {
    const previous = await prisma.bodyMeasurement.findFirst({
      where: { heightIn: { not: null } },
      orderBy: { date: 'desc' },
      select: { heightIn: true },
    })
    height = previous?.heightIn ?? undefined
  }
  const calculated = neckIn != null && waistIn != null && height != null ? navyBodyFatPct(neckIn, waistIn, height) : null
  const data = {
    weightLbs,
    bodyFatPct: calculated ?? bodyFatPct ?? null,
    neckIn: neckIn ?? null,
    waistIn: waistIn ?? null,
    heightIn: height ?? null,
    source: 'Manual',
  }
  return prisma.bodyMeasurement.upsert({
    where: { date: day },
    update: data,
    create: { date: day, ...data },
  })
}
