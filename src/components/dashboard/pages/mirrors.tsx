import { MirrorRules } from '@/components/dashboard/mirrors';

export function MirrorsBody({ slug }: { slug: string }) {
  return <MirrorRules slug={slug} />;
}
