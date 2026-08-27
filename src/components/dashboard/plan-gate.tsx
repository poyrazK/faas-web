import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';

export function PlanGate({ feature, description }: { feature: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-sm font-medium">{feature} is available on Hobby and above</p>
      <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Link
        to="/dashboard/plans"
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        Compare plans
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
