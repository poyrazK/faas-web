import { CopyIconButton } from '@/components/ui/copy-button';

const installCLI = 'curl -fsSL https://get.gregale.dev | sh';
const startCLI = 'gregale start';

export function FreeCliStart({ needsEmailVerification }: { needsEmailVerification: boolean }) {
  return (
    <section
      aria-labelledby="free-cli-start"
      className="flex flex-col gap-4 rounded-xl border border-brand/40 bg-card p-6"
    >
      <div>
        <h2 id="free-cli-start" className="text-lg font-semibold">
          Deploy a private Node app from your terminal
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {needsEmailVerification && (
            <>
              Open Gregale’s verification email in this browser and click{' '}
              <strong>Verify email</strong>.{' '}
            </>
          )}
          Keep this browser open to approve the CLI sign-in.
        </p>
      </div>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-relaxed">
        <li>
          Install the Gregale CLI.
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1">
            <code className="min-w-0 break-words">{installCLI}</code>
            <CopyIconButton text={installCLI} label="install command" />
          </div>
        </li>
        <li>
          Open a new terminal, change to an empty directory, and run:
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1">
            <code className="min-w-0 break-words">{startCLI}</code>
            <CopyIconButton text={startCLI} label={startCLI} />
          </div>
        </li>
        <li>
          Choose <strong>Create a starter</strong>, then{' '}
          <strong>Private Node.js HTTP app (Free plan)</strong>.
        </li>
      </ol>
      <a
        href="/docs/quickstart#deploy-a-private-node-app-on-free"
        className="self-start text-sm text-brand underline"
      >
        Private Node quickstart
      </a>
    </section>
  );
}
