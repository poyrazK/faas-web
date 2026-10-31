import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/deployments')({
  beforeLoad: movedTo('/dashboard/deployments', '/dashboard/releases'),
});
