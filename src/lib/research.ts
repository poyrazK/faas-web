interface ResearchPublication {
  slug: string;
  title: string;
  summary: string;
  publishedOn: string;
  measuredOn: string;
}

export const RESEARCH_TITLE = 'Research & Benchmarks';
export const RESEARCH_DESCRIPTION =
  'Measurements from Gregale infrastructure, with test conditions, downloadable data, and analysis scripts.';

export const RESEARCH_PUBLICATIONS: readonly ResearchPublication[] = [
  {
    slug: 'firecracker-snapshot-restore-ssd-2026-09-09',
    title: 'Firecracker snapshot restore on SSD',
    summary: 'Scheduler wake timing from 100 sequential snapshot restores on one SSD-backed node.',
    publishedOn: '2026-11-24',
    measuredOn: '2026-09-09',
  },
];

export function researchDate(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(date)
  );
}
