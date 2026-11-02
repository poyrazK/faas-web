import { createFileRoute } from '@tanstack/react-router';
import { ProjectInventory } from '@/components/dashboard/pages/project-inventory';

export const Route = createFileRoute('/dashboard/projects/')({ component: ProjectInventory });
