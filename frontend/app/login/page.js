"use client";
import { useRouter } from "next/navigation";

/* Protiviti brand */
const ORANGE = "#ee7624";
const ORANGE_DARK = "#d96a16";

export default function LoginPage() {
  const router = useRouter();

  function handleSubmit(e) {
    e.preventDefault();
    router.push("/schedules");
  }

  return (
    <div className="fixed inset-0 z-[100] flex bg-white overflow-hidden">
      {/* ───────────────── Left: brand panel (65%) ───────────────── */}
      <div
        className="relative hidden lg:flex lg:w-[65%] flex-shrink-0 overflow-hidden"
        style={{ background: "#000314" }}
      >
        {/* hero image — full artwork, letterbox blends into the navy panel */}
        <img
          src="/login-hero.png"
          alt=""
          className="absolute inset-0 w-full h-full object-contain"
        />
        {/* very light navy wash for cohesion (no text overlaps it now) */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, rgba(0,3,20,0.18) 0%, rgba(0,3,20,0.05) 55%, rgba(0,3,20,0) 100%)",
          }}
        />

        {/* logo — top left (whitened to sit on the dark panel) */}
        <img
          src="/protiviti-logo.png"
          alt="Protiviti — Global Business Consulting"
          className="absolute top-10 left-12 z-10 h-16 xl:h-20 w-auto"
          style={{ filter: "brightness(0) invert(1)" }}
        />

        {/* brand panel intentionally shows only the logo over the hero image */}
      </div>

      {/* ───────────────── Right: auth card ───────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-10" style={{ background: "#f6f8fb" }}>
        {/* mobile logo (left panel is hidden on small screens) */}
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6 flex justify-center">
            <img src="/protiviti-logo.png" alt="Protiviti" className="h-9 w-auto" />
          </div>

          <div className="bg-white rounded-2xl border border-neutral-150 shadow-card-lg px-8 sm:px-10 py-10">
            {/* Login */}
            <div className="flex justify-center border-b border-neutral-150">
              <span className="relative pb-3 text-xl font-bold" style={{ color: ORANGE }}>
                Login
                <span
                  className="absolute -bottom-px left-0 right-0 h-[2.5px] rounded-full"
                  style={{ background: ORANGE }}
                />
              </span>
            </div>

            {/* form */}
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Field label="Username" type="text" placeholder="Enter your username" />
              <Field label="Password" type="password" placeholder="Enter your password" />

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-white text-sm font-semibold shadow-sm transition-colors"
                style={{ background: ORANGE }}
                onMouseEnter={(e) => (e.currentTarget.style.background = ORANGE_DARK)}
                onMouseLeave={(e) => (e.currentTarget.style.background = ORANGE)}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
                </svg>
                Sign In
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── labelled input ─────────────────────────────────────────── */
function Field({ label, type, placeholder }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "#344054" }}>
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-2 transition-shadow"
        style={{ "--tw-ring-color": "#f3b888" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = ORANGE)}
        onBlur={(e) => (e.currentTarget.style.borderColor = "#d0d5dd")}
      />
    </div>
  );
}
