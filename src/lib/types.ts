// Shared types between web and mobile apps

export interface WorkoutSession {
  id: string;
  date: string;
  source: string;
  activity: string;
  minutes: number;
  miles?: number;
  weightLifted?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  name: string;
  year: number;
  annualWeightTarget: number;
  minutesPerSession: number;
  weeklySessionsTarget: number;
  weeklyMinutesTarget: number;
  annualMinutesTarget: number;
  quarterlyWeightTarget: number;
  quarterlyMinutesTarget: number;
  quarterlySessionsTarget: number;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlySummary {
  id: string;
  year: number;
  month: number;
  totalMinutes: number;
  totalMiles: number;
  totalSessions: number;
  averageWeight?: number;
}
