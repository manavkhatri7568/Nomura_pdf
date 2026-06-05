"use client";
import { createContext, useContext, useEffect, useState } from "react";

/*
 * Holds the Compare & Match pipeline state (synced emails, classification
 * results, active step, source) in a provider mounted in the root layout.
 *
 * Because the layout does NOT unmount when you navigate between pages, this
 * state survives moving to Workflow Schedules and back — no more re-syncing /
 * re-classifying on every visit. It is additionally mirrored to sessionStorage
 * so it also survives a page reload within the same browser session.
 */

const KEY = "cm.pipeline.v1";
const EMPTY = {
  source: "local",
  activeStep: 0,
  syncedEmails: null, // array of email summaries, or null if not synced
  syncTs: null, // last sync timestamp (display string)
  classified: null, // full classified list, or null if shortlist not run
  stats: null, // RunStats from the last shortlist run
  extractRows: null, // enriched trade register rows (body-parsed), cached so the
  extractKey: null,  // Extract step doesn't re-fetch/re-parse on every revisit
};

const PipelineCtx = createContext(null);

export function PipelineProvider({ children }) {
  const [state, setState] = useState(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once from sessionStorage (client only). Done in an effect rather
  // than a lazy initializer so server and first client render match (no
  // hydration mismatch).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setState({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change — but only after hydration, so we never clobber stored
  // data with the initial defaults.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [hydrated, state]);

  const value = {
    ...state,
    hydrated,
    setSource: (source) => setState((s) => ({ ...s, source })),
    setActiveStep: (activeStep) => setState((s) => ({ ...s, activeStep })),
    setSynced: (syncedEmails, syncTs) =>
      setState((s) => ({ ...s, syncedEmails, syncTs })),
    setClassified: (classified, stats) =>
      // New classification → invalidate the cached extract rows.
      setState((s) => ({ ...s, classified, stats, extractRows: null, extractKey: null })),
    setExtract: (extractRows, extractKey) =>
      setState((s) => ({ ...s, extractRows, extractKey })),
    resetPipeline: () => setState(EMPTY),
  };

  return <PipelineCtx.Provider value={value}>{children}</PipelineCtx.Provider>;
}

export function usePipeline() {
  const ctx = useContext(PipelineCtx);
  if (!ctx) throw new Error("usePipeline must be used within <PipelineProvider>");
  return ctx;
}
