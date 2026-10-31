import { createFileRoute } from '@tanstack/react-router';
import { movedTo } from '@/lib/moved-route';

export const Route = createFileRoute('/dashboard/apis')({
  beforeLoad: movedTo('/dashboard/apis', '/dashboard/routes'),
});
