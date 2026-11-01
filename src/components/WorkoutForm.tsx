'use client'

import { workoutDay } from '@/lib/calendar'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { WorkoutSession } from '@/types/workout'

interface WorkoutFormData {
  date: string
  source: string
  activity: string
  minutes: string | number
  miles?: string | number
  weightLifted?: string | number
  notes?: string
}

interface WorkoutFormProps {
  onSubmit: (session: Omit<WorkoutSession, 'id'>, requestId?: string) => void | Promise<void>
  initial?: Partial<WorkoutSession>
  submitLabel?: string
}

function toLocalDateInputValue(d: Date) { return workoutDay(d) }
function parseLocalDateInput(dateString: string): Date { return new Date(`${dateString}T12:00:00Z`) }

// Helper to format weight with commas (no decimals)
function formatWeight(value: string | number): string {
  if (!value) return ''
  const numValue = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value
  if (isNaN(numValue)) return ''
  return Math.floor(numValue).toLocaleString('en-US')
}

// Helper to parse formatted weight back to number
function parseWeight(formattedValue: string): number {
  const cleaned = formattedValue.replace(/,/g, '')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0 : Math.floor(parsed)
}

// Helper to get custom activities from localStorage
function getStoredCustomActivities(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem('customActivities')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

// Helper to save custom activity to localStorage
function saveCustomActivity(activity: string) {
  if (typeof window === 'undefined') return
  try {
    const stored = getStoredCustomActivities()
    if (!stored.includes(activity)) {
      const updated = [...stored, activity].slice(-20) // Keep last 20 custom activities
      localStorage.setItem('customActivities', JSON.stringify(updated))
    }
  } catch {
    // Ignore localStorage errors
  }
}

export function WorkoutForm({ onSubmit, initial, submitLabel = 'Add Workout' }: WorkoutFormProps) {
  // Default to today, or initial date if provided
  const [saveError, setSaveError] = useState<string | null>(null)
  const requestId = useRef<string | null>(null)
  const today = useMemo(() => new Date(), [])
  const defaultDate = toLocalDateInputValue(initial?.date ?? today)

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting }, setValue } = useForm<WorkoutFormData>({
    defaultValues: {
      date: defaultDate,
      source: initial?.source ?? '',
      activity: initial?.activity ?? '',
      minutes: initial?.minutes ?? '',
      miles: initial?.miles,
      weightLifted: initial?.weightLifted,
      notes: initial?.notes ?? ''
    }
  })

  useEffect(() => {
    reset({
      date: toLocalDateInputValue(initial?.date ?? today),
      source: initial?.source ?? '',
      activity: initial?.activity ?? '',
      minutes: initial?.minutes ?? 0,
      miles: initial?.miles,
      weightLifted: initial?.weightLifted,
      notes: initial?.notes ?? ''
    })
  }, [initial, reset, today])

  const activity = watch('activity')
  const source = watch('source')
  
  // State for custom activity input
  const [customActivity, setCustomActivity] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customSuggestions, setCustomSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  
  // State for formatted weight input
  const [formattedWeight, setFormattedWeight] = useState('')
  
  // Initialize formatted weight from initial value
  useEffect(() => {
    if (initial?.weightLifted) {
      setFormattedWeight(formatWeight(initial.weightLifted))
    }
  }, [initial?.weightLifted])
  
  // Load stored custom activities on mount
  useEffect(() => {
    setCustomSuggestions(getStoredCustomActivities())
  }, [])
  
  // Watch for source changes to toggle custom input
  useEffect(() => {
    if (source === 'Other') {
      setShowCustomInput(true)
      setValue('activity', customActivity || 'Other')
    } else {
      setShowCustomInput(false)
      setCustomActivity('')
      // The source <select> onChange clears the activity; doing it here too
      // would wipe the saved activity when editing an existing workout.
    }
  }, [source, customActivity, setValue])

  const sources = ['Peloton', 'Apple Watch', 'Gym', 'Other']
  
  // Define source-to-activity mapping
  const sourceActivityMap: Record<string, string[]> = {
    'Peloton': ['Cycling', 'Outdoor cycling', 'Weight lifting', 'Walking', 'Running', 'Yoga'],
    'Apple Watch': ['Outdoor cycling', 'Running', 'Walking', 'Hiking', 'Swimming'],
    'Gym': ['Weight lifting', 'Running', 'Swimming'],
    'Other': ['Other']
  };
  
  // Get filtered activities based on selected source
  const getFilteredActivities = () => {
    if (!source) return [];
    return sourceActivityMap[source] || [];
  };
  
  const filteredActivities = getFilteredActivities();
  const activities = initial?.activity && source === initial.source && !filteredActivities.includes(initial.activity)
    ? [initial.activity, ...filteredActivities]
    : filteredActivities;
  
  // Show miles field for cardio activities or custom activities with cardio keywords
  const showMiles = (() => {
    const cardioActivities = ['Cycling', 'Outdoor cycling', 'Running', 'Swimming', 'Walking', 'Hiking'];
    if (cardioActivities.includes(activity)) return true;
    
    // For custom activities, check for cardio-related keywords
    if (source === 'Other' && customActivity) {
      const cardioKeywords = ['run', 'walk', 'swim', 'bike', 'cycle', 'jog', 'hike', 'row'];
      return cardioKeywords.some(keyword => 
        customActivity.toLowerCase().includes(keyword)
      );
    }
    return false;
  })();
  
  // Show weight lifted for strength activities or custom activities with strength keywords
  const showWeight = (() => {
    if (activity === 'Weight lifting') return true;
    
    // For custom activities, check for strength-related keywords
    if (source === 'Other' && customActivity) {
      const strengthKeywords = ['weight', 'lift', 'strength', 'gym', 'dumbbell', 'barbell', 'press', 'curl', 'squat'];
      return strengthKeywords.some(keyword => 
        customActivity.toLowerCase().includes(keyword)
      );
    }
    return false;
  })();

  const onFormSubmit = async (data: WorkoutFormData) => {
    const finalActivity = source === 'Other' && customActivity ? customActivity : data.activity
    
    // Save custom activity to localStorage if it's from Other source
    if (source === 'Other' && customActivity) {
      saveCustomActivity(customActivity)
    }
    
    const session: Omit<WorkoutSession, 'id'> = {
      date: parseLocalDateInput(data.date),
      source: data.source,
      activity: finalActivity,
      minutes: Number(data.minutes),
      miles: data.miles ? Number(data.miles) : undefined,
      weightLifted: data.weightLifted ? Number(data.weightLifted) : undefined,
      notes: data.notes || undefined
    }
    setSaveError(null)
    try {
      requestId.current ??= crypto.randomUUID()
      await onSubmit(session, requestId.current)
      requestId.current = null
      reset()
      setCustomActivity('')
      setFormattedWeight('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save workout. Please retry.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="grid grid-cols-2 gap-4">
      {/* Date */}
      <div>
        <label htmlFor="workout-date" className="field-label">
          Date
        </label>
        <input
          type="date"
          id="workout-date"
          {...register('date', { required: 'Date is required' })}
          className="field"
          style={{ maxWidth: '100%' }}
        />
        {errors.date && <p className="mt-1 text-xs text-danger">{errors.date.message}</p>}
      </div>

      {/* Source */}
      <div>
        <label htmlFor="workout-source" className="field-label">
          Source
        </label>
        <select
          id="workout-source"
          {...register('source', { required: 'Source is required' })}
          onChange={(e) => {
            setValue('source', e.target.value);
            setValue('activity', ''); // Reset activity when source changes
          }}
          className="field"
        >
          <option value="">Select source</option>
          {sources.map(src => (
            <option key={src} value={src}>{src}</option>
          ))}
        </select>
        {errors.source && <p className="mt-1 text-xs text-danger">{errors.source.message}</p>}
      </div>

      {/* Activity */}
      <div>
        <label htmlFor="workout-activity" className="field-label">
          Activity
        </label>
        <select
          id="workout-activity"
          {...register('activity', { required: 'Activity is required' })}
          disabled={!source}
          className="field"
        >
          <option value="">Select activity</option>
          {activities.map(act => (
            <option key={act} value={act}>{act}</option>
          ))}
        </select>
        {errors.activity && <p className="mt-1 text-xs text-danger">{errors.activity.message}</p>}
      </div>

      {/* Minutes */}
      <div>
        <label htmlFor="workout-minutes" className="field-label">
          Minutes
        </label>
        <input
          type="number"
          step="any"
          placeholder="Minutes"
          id="workout-minutes"
          {...register('minutes', { 
            required: 'Minutes is required',
            min: { value: 0, message: 'Minutes must be positive' }
          })}
          className="field"
        />
        {errors.minutes && <p className="mt-1 text-xs text-danger">{errors.minutes.message}</p>}
      </div>

      {/* Miles (conditional) */}
      {showMiles && (
        <div>
          <label htmlFor="workout-miles" className="field-label">
            Miles
          </label>
          <input
            type="number"
            step="any"
            placeholder="Miles"
            id="workout-miles"
            {...register('miles', {
              min: { value: 0, message: 'Miles must be positive' }
            })}
            className="field"
          />
        </div>
      )}

      {/* Weight Lifted (conditional) */}
      {showWeight && (
        <div>
          <label htmlFor="workout-weight" className="field-label">
            Weight Lifted (lbs)
          </label>
          <input
            type="text"
            id="workout-weight"
            placeholder="Weight (lbs)"
            value={formattedWeight}
            onChange={(e) => {
              const inputValue = e.target.value
              // Allow only numbers and commas
              const cleanedValue = inputValue.replace(/[^0-9,]/g, '')
              // Remove multiple commas and format
              const numericValue = cleanedValue.replace(/,/g, '')
              if (numericValue === '' || /^\d+$/.test(numericValue)) {
                const formatted = numericValue ? formatWeight(numericValue) : ''
                setFormattedWeight(formatted)
                // Update the form value with the numeric value
                setValue('weightLifted', numericValue ? parseWeight(formatted) : '')
              }
            }}
            onBlur={() => {
              // Ensure proper formatting on blur
              if (formattedWeight) {
                const parsed = parseWeight(formattedWeight)
                const reformatted = formatWeight(parsed)
                setFormattedWeight(reformatted)
                setValue('weightLifted', parsed)
              }
            }}
            className="field"
          />
        </div>
      )}

      {/* Notes */}
      <div className="col-span-2">
        <label htmlFor="workout-notes" className="field-label">
          Notes (optional)
        </label>
        <textarea
          id="workout-notes"
          {...register('notes')}
          placeholder="Any additional notes..."
          rows={3}
          className="field"
        />
      </div>

      {saveError && <p role="alert" className="col-span-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-fg">{saveError}</p>}

      {/* Submit Button */}
      <div className="col-span-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-volt w-full py-3 text-base"
        >
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
