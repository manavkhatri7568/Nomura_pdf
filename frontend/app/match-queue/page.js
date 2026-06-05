import Header from '@/components/layout/Header';

export default function MatchQueuePage() {
  return (
    <div className="flex flex-col flex-1">
      <Header breadcrumbs={['Classify & Extract', 'Match Queue']} />
      <main className="flex-1 p-6 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔗</p>
          <h2 className="text-base font-semibold text-neutral-700">Match Queue</h2>
          <p className="text-sm text-neutral-500 mt-1">Coming soon — Phase 2</p>
        </div>
      </main>
    </div>
  );
}
