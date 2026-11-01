'use client'

import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>
      }

      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="card max-w-sm p-8 text-center">
            <h1 className="mb-2 font-display text-2xl font-bold">Something went wrong</h1>
            <p className="mb-6 text-sm text-fg-muted">The app hit an error while loading.</p>
            <button onClick={() => window.location.reload()} className="btn-volt">
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
