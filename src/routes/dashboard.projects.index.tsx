import { createFileRoute } from '@tanstack/react-router';
import { ProjectInventory } from '@/components/dashboard/project-inventory-page';

export const Route = createFileRoute('/dashboard/projects/')({ component: ProjectInventory });
