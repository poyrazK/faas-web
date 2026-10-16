import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/databases')({
  beforeLoad: movedTo('/dashboard/databases', '/dashboard/upstreams'),
});
