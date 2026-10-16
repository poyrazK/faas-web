import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/traces')({
  beforeLoad: movedTo('/dashboard/traces', '/dashboard/invocations'),
});
