import { z } from 'zod'
export const goalInput = z.object({
  name: z.string().trim().min(1).max(200),
  year: z.number().int().min(2020).max(2100),
  annualWeightTarget: z.number().positive().lt(10_000_000),
  minutesPerSession: z.number().int().min(1).max(480),
  weeklySessionsTarget: z.number().int().min(1).max(30),
})
