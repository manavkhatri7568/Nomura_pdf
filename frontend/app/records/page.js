import Header from '@/components/layout/Header';

export default function RecordsPage() {
  return (
    <div className="flex flex-col flex-1">
      <Header breadcrumbs={['FX Trade Settlement', 'Records']} />
      <main className="flex-1 p-6 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">📋</p>
          <h2 className="text-base font-semibold text-neutral-700">Records</h2>
          <p className="text-sm text-neutral-500 mt-1">Coming soon — Phase 2</p>
        </div>
      </main>
    </div>
  );
}
