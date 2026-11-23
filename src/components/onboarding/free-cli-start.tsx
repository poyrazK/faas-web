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
          Deploy your first app from your terminal
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
          Open a new terminal in your app’s folder, or an empty one, and run:
          <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1">
            <code className="min-w-0 break-words">{startCLI}</code>
            <CopyIconButton text={startCLI} label={startCLI} />
          </div>
        </li>
        <li>
          Follow the prompts. Start deploys the app it finds in the folder; in an empty folder it
          offers starters to begin from.
        </li>
      </ol>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href="/docs/quickstart" className="text-brand underline">
          Quickstart
        </a>
        <a href="/docs/plans" className="text-brand underline">
          What fits on Free
        </a>
      </p>
    </section>
  );
}
