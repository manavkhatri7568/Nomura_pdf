'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

/* ─── Ring spinner ──────────────────────────────────────────── */
export function Spinner({ size = 'md', className }) {
  const px = { sm: 20, md: 32, lg: 44 }[size] ?? 32;
  return (
    <svg
      width={px} height={px}
      viewBox="0 0 32 32"
      fill="none"
      className={clsx('animate-spin', className)}
      style={{ animationDuration: '0.75s' }}
    >
      <circle cx="16" cy="16" r="12" stroke="#e2e8f0" strokeWidth="3" />
      <path
        d="M16 4 A12 12 0 0 1 28 16"
        stroke="#2563eb"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ─── Step-by-step process loader ──────────────────────────── */
export function ProcessLoader({ steps = [], currentStep = 0, title }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6">
      <Spinner size="lg" className="mb-5" />
      {title && (
        <p className="text-sm font-semibold text-neutral-800 mb-5">{title}</p>
      )}
      <div className="w-full max-w-xs space-y-2.5">
        {steps.map((step, i) => {
          const done    = i < currentStep;
          const active  = i === currentStep;
          const pending = i > currentStep;
          return (
            <div
              key={i}
              className={clsx(
                'flex items-center gap-3 text-xs transition-all duration-300',
                done    && 'text-emerald-600',
                active  && 'text-neutral-800',
                pending && 'text-neutral-300',
              )}
            >
              <span className={clsx(
                'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border',
                done    && 'bg-emerald-500 border-emerald-500',
                active  && 'border-brand-400 bg-brand-50',
                pending && 'border-neutral-200 bg-white',
              )}>
                {done ? (
                  <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3 text-white">
                    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-200" />
                )}
              </span>
              <span className={clsx('font-medium', active && 'text-neutral-900')}>{step}</span>
              {active && (
                <span className="ml-auto flex gap-0.5">
                  {[0,1,2].map(j => (
                    <span
                      key={j}
                      className="w-1 h-1 rounded-full bg-brand-400"
                      style={{ animation: `dotBounce 1.2s ease-in-out ${j * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Skeleton row ──────────────────────────────────────────── */
export function SkeletonRows({ rows = 6, cols = 6 }) {
  const widths = ['w-24', 'w-48', 'w-32', 'w-36', 'w-20', 'w-16'];
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-neutral-100">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3">
              <div
                className={clsx(
                  'h-3 bg-neutral-200 rounded skeleton-shimmer',
                  widths[c % widths.length],
                )}
                style={{ animationDelay: `${(r * 0.05 + c * 0.02).toFixed(2)}s` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ─── Inline hook for staged loading ───────────────────────── */
export function useStagedLoader(steps, stepDurationMs = 480) {
  const [step, setStep] = useState(-1);

  function start() {
    setStep(0);
    steps.forEach((_, i) => {
      setTimeout(() => setStep(i), i * stepDurationMs);
    });
  }

  function reset() { setStep(-1); }

  const totalMs = steps.length * stepDurationMs;

  return { step, start, reset, totalMs };
}
