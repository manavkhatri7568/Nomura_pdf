"use client";
import { useMemo } from "react";
import { usePipeline } from "@/lib/pipelineContext";
import Header from "@/components/layout/Header";
import StepSync from "@/components/pipeline/StepSync";
import StepShortlist from "@/components/pipeline/StepShortlist";
import StepExtract from "@/components/pipeline/StepExtract";

const STEPS = [
  { label: "Sync Emails" },
  { label: "Classify" },
  { label: "Extract Trade Data" },
];

const SOURCES = [
  { value: "local", label: "Local (.eml)" },
  { value: "graph", label: "Graph API" },
];

export default function PipelinePage() {
  // State lives in a context provider mounted in the layout, so it survives
  // navigating to Configure Agents and back (and a reload, via sessionStorage)
  // — no more re-syncing / re-classifying every visit.
  const {
    source, setSource,
    activeStep, setActiveStep,
    syncedEmails, syncTs, setSynced,
    classified, stats, setClassified,
  } = usePipeline();

  const shortlistDone = classified != null;
  const cases = useMemo(
    () => (classified ? classified.filter((e) => e.label === "RELEVANT") : null),
    [classified],
  );

  const pipelineStep = shortlistDone ? 2 : syncedEmails ? 1 : 0;

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <Header breadcrumbs={["Agentic Capabilities", "Classify & Extract"]} />

      <main className="flex-1 p-6 overflow-y-auto">
        {/* Page title row */}
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h1 className="text-base font-semibold text-neutral-900 heading-underline mb-3">
              Classify &amp; Extract Agentic Capability
            </h1>
          </div>

          {/* Source toggle */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-neutral-500 font-medium">Source</span>
            <div className="flex rounded-md border border-neutral-200 bg-white overflow-hidden shadow-sm">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSource(s.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors duration-100 ${
                    source === s.value
                      ? "bg-brand-600 text-white"
                      : "text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab bar + content in one unified card */}
        <div className="bg-white border border-neutral-200 rounded-xl shadow-card overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-neutral-150 px-1 bg-neutral-50/80">
            {STEPS.map((step, i) => {
              const done =
                i < pipelineStep ||
                (i === 0 && !!syncedEmails) ||
                (i === 1 && shortlistDone) ||
                (i === 2 && shortlistDone);   // Extract is the terminal step — done once the register is available
              const active = activeStep === i;
              const locked = i > pipelineStep;

              return (
                <button
                  key={i}
                  disabled={locked}
                  onClick={() => !locked && setActiveStep(i)}
                  className={[
                    "tab-btn relative flex items-center gap-2 px-5 py-3 text-xs font-medium select-none",
                    active
                      ? "tab-active text-sky-600 font-semibold"
                      : "",
                    !active && !locked
                      ? "text-slate-500 hover:text-slate-700 hover:bg-white"
                      : "",
                    locked
                      ? "tab-locked text-slate-400 cursor-not-allowed opacity-60"
                      : "cursor-pointer",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <StepBubble
                    index={i}
                    state={done ? "done" : active ? "active" : "locked"}
                  />
                  {step.label}
                  {done && !active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Step panels — all stay mounted; 'hidden' preserves state, CSS fade fires on reveal */}
          <div className="p-5">
            <div className={activeStep === 0 ? "tab-panel-enter" : "hidden"}>
              <StepSync
                source={source}
                onSynced={setSynced}
                initialEmails={syncedEmails}
                initialTs={syncTs}
              />
            </div>
            <div className={activeStep === 1 ? "tab-panel-enter" : "hidden"}>
              <StepShortlist
                source={source}
                enabled={!!syncedEmails}
                syncedEmails={syncedEmails ?? []}
                initialClassified={classified}
                initialStats={stats}
                onShortlisted={setClassified}
              />
            </div>
            <div className={activeStep === 2 ? "tab-panel-enter" : "hidden"}>
              <StepExtract enabled={shortlistDone} preloadedCases={cases} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepBubble({ index, state }) {
  const base =
    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0";
  if (state === "done")
    return (
      <span className={`${base} bg-emerald-500 text-white`}>
        <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
          <path
            fillRule="evenodd"
            d="M9.28 2.28a.75.75 0 0 1 .01 1.06l-4.75 5a.75.75 0 0 1-1.08 0l-2.25-2.37a.75.75 0 0 1 1.08-1.05L4.99 6.83l4.23-4.54a.75.75 0 0 1 1.06-.01Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  if (state === "locked")
    return (
      <span className={`${base} bg-neutral-200 text-neutral-400`}>
        {index + 1}
      </span>
    );
  return <span className={`${base} bg-brand-600 text-white`}>{index + 1}</span>;
}
