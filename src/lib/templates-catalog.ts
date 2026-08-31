import type { components } from '@/lib/api/schema';

export type TemplateView = components['schemas']['TemplateView'];
type Category = TemplateView['category'];

export const CATEGORY_LABEL: Record<Category, string> = {
  hello: 'Hello world',
  function: 'Functions',
  'stateless-contract': 'Stateless services',
  ai: 'AI',
};

const ORDER = Object.keys(CATEGORY_LABEL) as Category[];

/** Spec-order categories, empty ones dropped; within a group the API's order holds. */
export function groupTemplates(list: TemplateView[]): [Category, TemplateView[]][] {
  return ORDER.map(
    (c) => [c, list.filter((t) => t.category === c)] as [Category, TemplateView[]]
  ).filter(([, rows]) => rows.length > 0);
}

export const deployCommand = (name: string) => `gregale deploy --template ${name}`;
