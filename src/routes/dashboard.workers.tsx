import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/workers')({
  beforeLoad: movedTo('/dashboard/workers', '/dashboard/instances'),
});
