export interface Set {
  reps?: number;
  weight?: number;
  duration?: number;
  distance?: number;
}

export interface Exercise {
  name: string;
  sets: Set[];
}

export interface WorkoutData {
  name: string;
  type: 'strength' | 'cardio';
  exercises: Exercise[];
  date: string;
}

export interface WorkoutSession {
  id: string
  date: Date
  source: string
  activity: string
  minutes: number
  miles?: number
  adjustedMiles?: number // Miles with multiplier applied (for Cannondale)
  adjustedMinutes?: number // Minutes with multiplier applied (for Cannondale)
  estimatedMiles?: boolean // True when miles were calculated from default cycling speed
  weightLifted?: number
  notes?: string
  // Class details (Peloton / Apple Watch); null or absent for manual entries
  discipline?: string | null
  classTitle?: string | null
  instructor?: string | null
  calories?: number | null
  avgHeartRate?: number | null
  maxHeartRate?: number | null
  totalOutputKj?: number | null
}

// Type for API payload returned by /api/workouts
export interface WorkoutApiSession {
  id: string
  date: string
  source: string
  activity: string
  minutes: number
  miles?: number | null
  weightLifted?: number | null
  notes?: string | null
  discipline?: string | null
  classTitle?: string | null
  instructor?: string | null
  calories?: number | null
  avgHeartRate?: number | null
  maxHeartRate?: number | null
  totalOutputKj?: number | null
}


export interface Goal {
  id: string
  name: string
  year: number
  
  // Annual targets
  annualWeightTarget: number // Total lbs for the year
  minutesPerSession: number // Minutes per individual session
  weeklySessionsTarget: number // Sessions per week
  
  // Calculated fields (derived from above)
  weeklyMinutesTarget: number // minutesPerSession * weeklySessionsTarget
  annualMinutesTarget: number // weeklyMinutesTarget * 52
  quarterlyWeightTarget: number // annualWeightTarget / 4
  quarterlyMinutesTarget: number // annualMinutesTarget / 4
  quarterlySessionsTarget: number // weeklySessionsTarget * 13
  
  createdAt: Date
  updatedAt: Date
}

export interface GoalProgress {
  // Current period progress
  currentQuarter: number
  currentYear: number
  
  // Actual progress
  actualWeightLifted: {
    quarterToDate: number
    yearToDate: number
  }
  actualMinutes: {
    quarterToDate: number
    yearToDate: number
  }
  actualSessions: {
    quarterToDate: number
    yearToDate: number
  }
  
  // Expected progress (linear)
  expectedWeightLifted: {
    quarterToDate: number
    yearToDate: number
  }
  expectedMinutes: {
    quarterToDate: number
    yearToDate: number
  }
  expectedSessions: {
    quarterToDate: number
    yearToDate: number
  }
  
  // Sessions needed
  sessionsNeededForQuarter: number
  sessionsNeededForYear: number
  
  // Time remaining
  daysRemainingInQuarter: number
}
