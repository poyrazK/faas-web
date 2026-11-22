import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CopyIconButton } from '@/components/ui/copy-button';
import { Modal } from '@/components/ui/modal';
import type { AgentBudget } from '@/lib/api/agents';
import { budgetWords, type AgentTone } from '@/lib/agents';
import { CliCommand } from '../cli-command';

export const TONE_COLOR: Record<AgentTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  none: 'var(--muted-foreground)',
};

/** The quiet link above a page that hangs off the Agents list. */
export const BACK_LINK =
  'inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground';

/** The page's opening sentence: the state, and whether anything needs doing. */
export function Answer({
  label,
  tone,
  children,
}: {
  label: string;
  tone: AgentTone;
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      aria-label={label}
      className="flex max-w-[44rem] items-start gap-2.5 text-lg leading-7 font-semibold tracking-[-0.01em] text-balance"
    >
      <span
        aria-hidden
        className="mt-2.5 inline-block size-2 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      <span>{children}</span>
    </p>
  );
}

/** A small coloured dot before a short status phrase. */
export function ToneLabel({ tone, children }: { tone: AgentTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      {children}
    </span>
  );
}

/**
 * What the agent committed this month against its budget, as one scalar bar.
 * Without a limit there is nothing to fill, so only the amount is shown.
 */
export function BudgetMeter({
  budget,
  label,
  compact = false,
}: {
  budget: AgentBudget;
  label: string;
  compact?: boolean;
}) {
  const words = budgetWords(budget);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p
        className={
          compact
            ? 'text-sm whitespace-nowrap [font-variant-numeric:tabular-nums]'
            : 'text-base font-medium [font-variant-numeric:tabular-nums]'
        }
      >
        {words.amount}
      </p>
      {words.ratio !== undefined && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label={label}
          aria-valuenow={Math.round(words.ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${words.ratio * 100}%`, background: TONE_COLOR[words.tone] }}
          />
        </div>
      )}
    </div>
  );
}

/** The hosted MCP server every client connects to (content/docs/agents.md). */
export const HOSTED_MCP_URL = 'https://api.gregale.dev/mcp';

/** How to connect an agent: the CLI's one command, or the URL for any MCP client. */
export function ConnectAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect an agent"
      description="The agent signs in once in your browser, where you choose what it may do. It shows up here after that."
      width="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <CliCommand
          label="Sets up Claude Code, Codex, Cursor, VS Code, Windsurf and Antigravity"
          command="gregale mcp connect"
          copyLabel="command that connects your agents"
        />
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Or add this server to any MCP client</p>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
            <code className="min-w-0 flex-1 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
              {HOSTED_MCP_URL}
            </code>
            <CopyIconButton text={HOSTED_MCP_URL} label="hosted MCP server address" />
          </div>
        </div>
        <CliCommand
          label="For an agent with nobody at a browser, such as CI"
          command="gregale mcp connect --headless"
          copyLabel="command that creates an agent key"
        />
        <p className="text-sm text-muted-foreground">
          <Link
            to="/docs/$slug"
            params={{ slug: 'agents' }}
            className="text-brand underline underline-offset-4"
          >
            Read the guide
          </Link>{' '}
          for keys, approvals and budgets.
        </p>
      </div>
    </Modal>
  );
}
