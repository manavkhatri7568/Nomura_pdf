"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { usePipeline } from "@/lib/pipelineContext";

export default function Header({ title, breadcrumbs = [] }) {
  const [health, setHealth] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const router = useRouter();
  const { resetPipeline } = usePipeline();

  useEffect(() => {
    api
      .health()
      .then((d) => setHealth(d?.status ?? "healthy"))
      .catch(() => setHealth("unreachable"));
  }, []);

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    function onKey(e) { if (e.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function handleLogout() {
    setMenuOpen(false);
    resetPipeline?.();        // clear the pipeline session so the next login is fresh
    router.push("/login");
  }

  const isHealthy = health === "healthy" || health === "ok";

  return (
    <header
      className="px-6 sticky top-0 z-30 flex items-center justify-between h-16 flex-shrink-0"
      style={{
        background: 'linear-gradient(90deg, #112244 0%, #1a3260 100%)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L9.19 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            )}
            <span
              className="text-[13px]"
              style={{
                color: i === breadcrumbs.length - 1 ? '#ffffff' : 'rgba(255,255,255,0.65)',
                fontWeight: i === breadcrumbs.length - 1 ? 500 : 400,
              }}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-3">

        {/* API health */}
        <div className="flex items-center gap-1.5">
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
            background: health === null ? 'rgba(255,255,255,0.2)' : isHealthy ? '#12b76a' : '#f04438',
          }} />
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.72)' }}>
            {health === null ? 'Checking…' : isHealthy ? 'API Online' : 'API Offline'}
          </span>
        </div>

        <div className="w-px h-3.5" style={{ background: 'rgba(255,255,255,0.1)' }} />

        {/* Avatar + account menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="Account"
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white/30"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            HP
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-card-lg border border-neutral-150 py-1 z-50">
              <div className="px-3 py-2.5 border-b border-neutral-100">
                <p className="text-xs font-semibold text-neutral-800">Hariprasath</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">SSG Operations</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-neutral-400">
                  <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114L8.704 10.75h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
