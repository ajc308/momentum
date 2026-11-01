// API payload shape for /api/body-measurements (dates as ISO strings over the wire)
export interface BodyMeasurementApiRecord {
  id: string
  date: string
  weightLbs: number
  bmi?: number | null
  bodyFatPct?: number | null
  waterPct?: number | null
  musclePct?: number | null
  boneMassPct?: number | null
  bmr?: number | null
  visceralFatLevel?: number | null
  subcutaneousFatPct?: number | null
  proteinPct?: number | null
  bodyAgeYears?: number | null
  leanBodyMassLbs?: number | null
  fatFreeWeightLbs?: number | null
  heartRateBpm?: number | null
  neckIn?: number | null
  waistIn?: number | null
  heightIn?: number | null
  source: string
}

// Client-side shape, with `date` parsed to a Date.
export interface BodyMeasurement extends Omit<BodyMeasurementApiRecord, 'date'> {
  date: Date
}

// Daily Apple Health metric row from /api/health-metrics
export interface HealthMetricApiRow {
  name: string
  date: string
  units: string | null
  qty: number | null
  min: number | null
  avg: number | null
  max: number | null
}
