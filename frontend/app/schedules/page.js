"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Header from "@/components/layout/Header";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import { CheckCircleIcon, ClockIcon, XCircleIcon } from "@/components/ui/Icons";

const DEFAULT_KEYWORDS = [
  "fx trade settlement",
  "settlement instructions",
  "deal reference",
  "fx trade",
  "currency pair",
];

const DEFAULT_EXTRACT_FIELDS = [
  "trade id",
  "currency pair",
  "asset class",
  "amount",
  "counter party",
  "direction",
];

/* ─── seed data ─────────────────────────────────────────────── */
const SEED = [
  {
    id: 1,
    name: "Classify & Extract",
    description:
      "Sync mailboxes, shortlist FX settlement emails",
    frequency: 24,
    lastRun: "2026-06-01T00:00:00Z",
    enabled: true,
    health: "healthy",
    href: "/pipeline",
    keywords: [...DEFAULT_KEYWORDS],
    extractFields: [...DEFAULT_EXTRACT_FIELDS],
    syncsBackend: true, // this agent drives the live rule classifier via /config
  },
];

/* ─── agent capability templates (the "Agent name" dropdown) ─── */
const AGENT_TEMPLATES = [
  {
    name: "Classify & Extract",
    description: "Sync mailboxes, shortlist FX settlement emails",
    href: "/pipeline",
    frequency: 24,
    keywords: [...DEFAULT_KEYWORDS],
    extractFields: [...DEFAULT_EXTRACT_FIELDS],
  },
];

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ─── Chip input component ──────────────────────────────────── */
function ChipInput({ chips, onChange }) {
  const [input, setInput] = useState("");

  function addChip() {
    const v = input.trim().toLowerCase();
    if (v && !chips.includes(v)) {
      onChange([...chips, v]);
    }
    setInput("");
  }

  function removeChip(chip) {
    onChange(chips.filter((c) => c !== chip));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addChip();
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 min-h-[72px]">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {chips.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-50 text-brand-700 border border-brand-200"
          >
            {chip}
            <button
              type="button"
              onClick={() => removeChip(chip)}
              className="text-brand-400 hover:text-brand-700 transition-colors ml-0.5"
            >
              <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                <path d="M3.22 3.22a.75.75 0 0 1 1.06 0L6 4.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L7.06 6l1.72 1.72a.75.75 0 1 1-1.06 1.06L6 7.06l-1.72 1.72a.75.75 0 0 1-1.06-1.06L4.94 6 3.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add keyword…"
          className="flex-1 px-2 py-1 text-[11px] border border-neutral-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={addChip}
          className="px-2 py-1 text-[11px] font-medium text-brand-600 bg-white border border-brand-200 rounded hover:bg-brand-50 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ─── Edit frequency modal ──────────────────────────────────── */
function EditModal({ workflow, onSave, onReset, onClose }) {
  const [freq, setFreq] = useState(String(workflow.frequency));
  const [unit, setUnit] = useState("hours");
  const [keywords, setKeywords] = useState(
    workflow.keywords ? [...workflow.keywords] : [...DEFAULT_KEYWORDS]
  );
  const [extractFields, setExtractFields] = useState(
    workflow.extractFields ? [...workflow.extractFields] : [...DEFAULT_EXTRACT_FIELDS]
  );
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSave() {
    const n = parseInt(freq);
    if (isNaN(n) || n < 1) {
      setErr("Run frequency must be a positive whole number.");
      return;
    }
    if (keywords.length === 0) {
      setErr("Add at least one shortlisting keyword.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await onSave({ frequency: n, keywords, extractFields });
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setErr(null);
    try {
      const cfg = await onReset();
      setKeywords([...(cfg.asset_keywords ?? DEFAULT_KEYWORDS)]);
      setExtractFields([...(cfg.extract_fields ?? DEFAULT_EXTRACT_FIELDS)]);
      setFreq(String(cfg.sync_frequency_hours ?? 24));
    } catch (e) {
      setErr(e.message || "Failed to reset configuration.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg bg-white rounded-xl shadow-card-lg border border-neutral-200 flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-neutral-150 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Edit Schedule
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">{workflow.name}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded hover:bg-neutral-100 flex items-center justify-center text-neutral-400 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 space-y-5 overflow-y-auto flex-1">
          {/* Frequency */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1.5">
              Run frequency
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={freq}
                onChange={(e) => setFreq(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="minutes">Minutes</option>
              </select>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-400">
              Currently: every {workflow.frequency} hours
            </p>
          </div>

          {/* Shortlisting keywords */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-0.5">
              Shortlisting keywords
            </label>
            <p className="text-[11px] text-neutral-400 mb-2">
              Emails matching these keywords will be shortlisted for processing.
            </p>
            <ChipInput chips={keywords} onChange={setKeywords} />
          </div>

          {/* Fields to extract */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-0.5">
              Fields to extract
            </label>
            <p className="text-[11px] text-neutral-400 mb-2">
              Data fields the agent will extract from each matched email.
            </p>
            <ChipInput chips={extractFields} onChange={setExtractFields} />
          </div>

          {/* loop explainer */}
          <div className="flex items-start gap-2 p-3 bg-brand-50 border border-brand-200 rounded-lg text-[11px] text-brand-700">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-px">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
            </svg>
            <span>Shortlisting keywords feed the rule classifier directly (asset-level signal, <strong>+0.5</strong>). Saving updates the live pipeline — re-run <strong>Classify &amp; Extract</strong> to see the new classifications.</span>
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-px">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-neutral-150 flex items-center justify-between gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleReset} loading={resetting} disabled={saving}>
            Reset to defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving || resetting}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={resetting}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Delete confirm modal ──────────────────────────────────── */
function DeleteModal({ workflow, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm bg-white rounded-xl shadow-card-lg border border-neutral-200">
        <div className="px-5 py-5">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5 text-red-600"
            >
              <path
                fillRule="evenodd"
                d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-neutral-900 mb-1">
            Delete schedule
          </h3>
          <p className="text-xs text-neutral-500">
            Are you sure you want to delete <strong>{workflow.name}</strong>?
            This action cannot be undone.
          </p>
        </div>
        <div className="px-5 py-4 border-t border-neutral-150 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onConfirm(workflow.id);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Add agent modal ───────────────────────────────────────── */
function AddModal({ templates, onAdd, onClose }) {
  const [templateName, setTemplateName] = useState(templates[0]?.name ?? "");
  const template = templates.find((t) => t.name === templateName) ?? templates[0];
  const [description, setDescription] = useState(template?.description ?? "");
  const [freq, setFreq] = useState(String(template?.frequency ?? 24));
  const [unit, setUnit] = useState("hours");
  const [keywords, setKeywords] = useState([...(template?.keywords ?? DEFAULT_KEYWORDS)]);
  const [extractFields, setExtractFields] = useState([...(template?.extractFields ?? DEFAULT_EXTRACT_FIELDS)]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Selecting a different capability pre-fills its defaults (user can edit).
  function selectTemplate(name) {
    setTemplateName(name);
    const t = templates.find((x) => x.name === name);
    if (t) {
      setDescription(t.description);
      setFreq(String(t.frequency));
      setKeywords([...t.keywords]);
      setExtractFields([...t.extractFields]);
    }
  }

  async function handleAdd() {
    const n = parseInt(freq);
    if (!templateName) { setErr("Select an agent."); return; }
    if (!description.trim()) { setErr("Add a description."); return; }
    if (isNaN(n) || n < 1) { setErr("Run frequency must be a positive whole number."); return; }
    if (keywords.length === 0) { setErr("Add at least one shortlisting keyword."); return; }
    setSaving(true);
    setErr(null);
    try {
      await onAdd({
        name: templateName,
        description: description.trim(),
        frequency: n,
        keywords,
        extractFields,
        href: template?.href ?? "/pipeline",
      });
      onClose();
    } catch (e) {
      setErr(e.message || "Failed to add agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-white rounded-xl shadow-card-lg border border-neutral-200 flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-neutral-150 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Add Agent</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Configure a new agent from a capability template</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded hover:bg-neutral-100 flex items-center justify-center text-neutral-400 transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-5 overflow-y-auto flex-1">
          {/* Agent name (dropdown of configured capabilities) */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1.5">Agent name</label>
            <select
              value={templateName}
              onChange={(e) => selectTemplate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {templates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-neutral-400">Choose from the available agent capabilities.</p>
          </div>

          {/* Description (free text) */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Sync mailboxes, shortlist FX settlement emails"
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-1.5">Run frequency</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                value={freq}
                onChange={(e) => setFreq(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="px-3 py-2 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="minutes">Minutes</option>
              </select>
            </div>
          </div>

          {/* Shortlisting keywords */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-0.5">Shortlisting keywords</label>
            <p className="text-[11px] text-neutral-400 mb-2">Emails matching these keywords will be shortlisted for processing.</p>
            <ChipInput chips={keywords} onChange={setKeywords} />
          </div>

          {/* Fields to extract */}
          <div>
            <label className="block text-xs font-semibold text-neutral-600 mb-0.5">Fields to extract</label>
            <p className="text-[11px] text-neutral-400 mb-2">Data fields the agent will extract from each matched email.</p>
            <ChipInput chips={extractFields} onChange={setExtractFields} />
          </div>

          {err && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0 mt-px">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              {err}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-neutral-150 flex items-center justify-end gap-2 flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleAdd} loading={saving}>
            {saving ? "Adding…" : "Add agent"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── main page ─────────────────────────────────────────────── */
export default function SchedulesPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState(SEED);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [adding, setAdding] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  function flashSaved(msg) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 6000);
  }

  // Hydrate the workflow's live settings from the backend config on mount, so
  // the editor shows what the classifier is actually using.
  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setWorkflows((ws) =>
          ws.map((w) =>
            w.id === 1
              ? {
                  ...w,
                  keywords: cfg.asset_keywords ?? w.keywords,
                  extractFields: cfg.extract_fields ?? w.extractFields,
                  frequency: cfg.sync_frequency_hours ?? w.frequency,
                }
              : w,
          ),
        );
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleEnabled(id) {
    setWorkflows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w)),
    );
  }

  // Persist an edit. The primary agent (syncsBackend) drives the live rule
  // classifier via /config; additional catalog agents are saved locally.
  // Throws on backend failure so the modal can surface it and stay open.
  async function saveWorkflow(id, { frequency, keywords, extractFields }) {
    const wf = workflows.find((w) => w.id === id);
    if (wf?.syncsBackend) {
      const cfg = await api.updateConfig({
        asset_keywords: keywords,
        extract_fields: extractFields,
        sync_frequency_hours: frequency,
      });
      setWorkflows((ws) =>
        ws.map((w) =>
          w.id === id
            ? {
                ...w,
                frequency: cfg.sync_frequency_hours ?? frequency,
                keywords: cfg.asset_keywords ?? keywords,
                extractFields: cfg.extract_fields ?? extractFields,
              }
            : w,
        ),
      );
      flashSaved(
        "Configuration saved and applied to the live pipeline. Re-run Classify & Extract to see the updated classifications.",
      );
    } else {
      setWorkflows((ws) =>
        ws.map((w) => (w.id === id ? { ...w, frequency, keywords, extractFields } : w)),
      );
      flashSaved("Agent configuration saved.");
    }
  }

  // Create a new catalog agent from the Add modal.
  function addWorkflow({ name, description, frequency, keywords, extractFields, href }) {
    setWorkflows((ws) => {
      const nextId = ws.reduce((m, w) => Math.max(m, w.id), 0) + 1;
      return [
        ...ws,
        {
          id: nextId,
          name,
          description,
          frequency,
          lastRun: null,
          enabled: true,
          health: "healthy",
          href: href ?? "/pipeline",
          keywords,
          extractFields,
          syncsBackend: false,
        },
      ];
    });
    flashSaved(`Agent “${name}” added.`);
  }

  // Reset within the editor: backend reset for the primary agent, local reset
  // to defaults for catalog agents. Returns the config the modal re-reads.
  async function resetConfigFor(workflow) {
    let cfg;
    if (workflow?.syncsBackend) {
      cfg = await api.resetConfig();
    } else {
      cfg = {
        asset_keywords: [...DEFAULT_KEYWORDS],
        extract_fields: [...DEFAULT_EXTRACT_FIELDS],
        sync_frequency_hours: 24,
      };
    }
    setWorkflows((ws) =>
      ws.map((w) =>
        w.id === workflow?.id
          ? {
              ...w,
              keywords: cfg.asset_keywords,
              extractFields: cfg.extract_fields,
              frequency: cfg.sync_frequency_hours,
            }
          : w,
      ),
    );
    return cfg;
  }

  function deleteWorkflow(id) {
    setWorkflows((ws) => ws.filter((w) => w.id !== id));
  }

  const total = workflows.length;
  const active = workflows.filter((w) => w.enabled).length;
  const inactive = workflows.filter((w) => !w.enabled).length;

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <Header breadcrumbs={["Agentic Capabilities", "Configure Agents"]} />

      {editing && (
        <EditModal
          workflow={editing}
          onSave={(data) => saveWorkflow(editing.id, data)}
          onReset={() => resetConfigFor(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <AddModal
          templates={AGENT_TEMPLATES}
          onAdd={addWorkflow}
          onClose={() => setAdding(false)}
        />
      )}
      {deleting && (
        <DeleteModal
          workflow={deleting}
          onConfirm={deleteWorkflow}
          onClose={() => setDeleting(null)}
        />
      )}

      <main className="flex-1 p-6 overflow-y-auto">
        {/* Page header */}
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h1 className="text-base font-semibold text-neutral-900 heading-underline mb-3">
              Agentic Capabilities Configuration
            </h1>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAdding(true)}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
              </svg>
            }
          >
            Add Agent
          </Button>
        </div>

        {/* Save confirmation / load error */}
        {savedMsg && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-xs">
            <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span>{savedMsg}</span>
          </div>
        )}
        {loadErr && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
            <span>Could not load saved configuration ({loadErr}). Showing defaults.</span>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard
            label="Total Agents"
            value={total}
            icon={<ClockIcon />}
            color="blue"
          />
          <StatCard
            label="Active"
            value={active}
            icon={<CheckCircleIcon />}
            color="green"
          />
          <StatCard
            label="Inactive"
            value={inactive}
            icon={<XCircleIcon />}
            color="neutral"
          />
        </div>

        {/* Table */}
        <div className="bg-white border border-neutral-200 rounded-xl shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-150 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Scheduled Agents
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Configure execution frequency, monitor health and enable/disable
                agents
              </p>
            </div>
          </div>

          {workflows.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-3 text-neutral-400">
                <ClockIcon className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-neutral-700">
                No agents configured
              </p>
              <p className="text-xs text-neutral-400 mt-1">
                Add an agent to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs data-table">
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-150">
                    {[
                      "Agent Name",
                      "Frequency",
                      "Last Executed",
                      "Health",
                      "Status",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {workflows.map((w) => (
                    <tr
                      key={w.id}
                      className="hover:bg-neutral-50/70 transition-colors"
                    >
                      {/* Workflow Name */}
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-neutral-900">
                          {w.name}
                        </p>
                        <p className="text-[11px] text-neutral-400 mt-0.5 max-w-xs ">
                          {w.description}
                        </p>
                      </td>
                      {/* Frequency */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-neutral-700">
                          <ClockIcon className="w-3.5 h-3.5 text-neutral-400" />
                          Every {w.frequency} hour{w.frequency !== 1 ? "s" : ""}
                        </span>
                      </td>
                      {/* Last executed */}
                      <td className="px-4 py-3.5 text-neutral-600 whitespace-nowrap font-mono text-[11px]">
                        {fmtDate(w.lastRun)}
                      </td>
                      {/* Health */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {w.health === "healthy" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#027a48]">
                            <span className="w-2 h-2 rounded-full bg-[#12b76a] animate-pulse" />
                            Healthy
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            Degraded
                          </span>
                        )}
                      </td>
                      {/* Enable/Disable toggle */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleEnabled(w.id)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${w.enabled ? "bg-brand-500" : "bg-neutral-200"}`}
                            title={w.enabled ? "Disable" : "Enable"}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${w.enabled ? "translate-x-4" : "translate-x-0"}`}
                            />
                          </button>
                          <span
                            className={`text-xs font-medium ${w.enabled ? "text-[#027a48]" : "text-neutral-400"}`}
                          >
                            {w.enabled ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => router.push(w.href)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-md transition-colors whitespace-nowrap"
                          >
                            View
                            <svg
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                fillRule="evenodd"
                                d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={() => setEditing(w)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-md transition-colors"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="w-3 h-3"
                            >
                              <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.261-4.263a1.75 1.75 0 0 0 0-2.474ZM4.75 14.25h6.5a.75.75 0 0 0 0-1.5h-6.5a.75.75 0 0 0 0 1.5Z" />
                            </svg>
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleting(w)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-600 bg-white hover:bg-red-50 border border-neutral-200 hover:border-red-200 rounded-md transition-colors"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="w-3 h-3"
                            >
                              <path
                                fillRule="evenodd"
                                d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
