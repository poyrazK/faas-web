import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/workflows/')({
  beforeLoad: movedTo('/dashboard/workflows', '/dashboard/apps'),
});
