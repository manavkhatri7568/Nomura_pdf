'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const nav = [
  {
    section: 'Workflows',
    items: [
      {
        label: 'Classify & Extract',
        href: '/pipeline',
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-[15px] h-[15px]">
            <path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h16.5a.75.75 0 0 1 0 1.5H18v8.75A2.75 2.75 0 0 1 15.25 15h-1.072l.798 3.06a.75.75 0 0 1-1.452.38L13.41 18H6.59l-.114.44a.75.75 0 0 1-1.452-.38L5.823 15H4.75A2.75 2.75 0 0 1 2 12.25V3.5h-.25A.75.75 0 0 1 1 2.75Z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
  {
    section: 'System',
    items: [
      {
        label: 'Configure Agents',
        href: '/schedules',
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-[15px] h-[15px]">
            <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-[15px] h-[15px]">
            <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-64 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: 'linear-gradient(180deg, #112244 0%, #091326 100%)' }}
    >
      {/* Brand — same height as header for seamless alignment */}
      <div
        className="flex items-center gap-3 px-5 h-16 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
            <path d="M3.5 2.75a.75.75 0 0 0-1.5 0v14.5a.75.75 0 0 0 1.5 0v-4.392l1.657-.348a21.025 21.025 0 0 1 8.468.5 19.58 19.58 0 0 0 2.875.25v-9.5a19.58 19.58 0 0 0-2.875-.25 21.026 21.026 0 0 1-8.468.5L3.5 3.35V2.75Z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-none truncate" style={{ color: '#e8f0fe' }}>Agentic Capabilities</p>
          <p className="text-[11px] leading-none mt-1 truncate" style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: '0.05em' }}>NOMURA · SSG</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto pt-6 pb-3">
        {nav.map((group, gi) => (
          <div key={group.section} className={gi > 0 ? 'mt-6' : ''}>
            <p
              className="px-4 mb-2 text-[11px] font-semibold uppercase select-none"
              style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}
            >
              {group.section}
            </p>
            <ul>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={`sidebar-link${active ? ' active' : ''}`}>
                      <span className="sidebar-icon">{item.icon}</span>
                      <span className="nav-label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative flex-shrink-0">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              HP
            </div>
            <span
              className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full"
              style={{ background: '#12b76a', border: '1.5px solid #112244' }}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium leading-none truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>Hariprasath</p>
            <p className="text-[10px] leading-none mt-[3px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>SSG Operations</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
