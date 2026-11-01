import { describe, expect, it } from 'vitest';
import {
  cliBucketEncryptionCommand,
  cliBucketLifecycleCommand,
  cliBucketObjectLockCommand,
  cliBucketUploadsCommand,
  cliBucketVersioningCommand,
  cliDeployCommand,
  cliDomainSetDefaultCommand,
  cliInitCommand,
  cliInitDeployCommand,
  cliJobRemoveCommand,
  cliJobRunCommand,
  cliPostgresRestoreCommand,
  cliPreAuthCommand,
} from './cli-commands';

// The CLI's own usage lines, copied from poyrazK/faas cmd/gregale:
//   init:   "gregale init --template <name> --path <dir> [--deploy] [--name <slug>] ..."
//   deploy: names the app with --name; --app is a boolean shape selector, so
//           `deploy --app my-app` is rejected with "Did you mean `gregale deploy --name my-app`?"
describe('cli commands handed out by the console', () => {
  it('deploys an existing app by --name, never --app <slug>', () => {
    expect(cliDeployCommand('my-api')).toBe('gregale deploy --name my-api');
  });

  it('scaffolds a template into a directory named after it, since init requires --path', () => {
    expect(cliInitCommand('hello-node')).toBe(
      'gregale init --template hello-node --path hello-node'
    );
  });

  it('scaffolds a template with the required --path and deploys it to the created app', () => {
    expect(cliInitDeployCommand('hello-python', 'my-api')).toBe(
      'gregale init --template hello-python --path my-api --deploy --name my-api'
    );
  });
});

// Each usage line below is quoted from poyrazK/faas cmd/gregale (origin/main).
describe('jobs commands', () => {
  // commands_jobs.go cmdJobsRun:
  //   "usage: gregale jobs run <name> (--tasks N | --input ID=REF ...) [--parallelism N] [--retries N] [--timeout S] [--env K=V ...] [--arg VALUE ...]"
  it('runs a job with --tasks, the count the CLI requires when there is no --input', () => {
    expect(cliJobRunCommand('nightly-report')).toBe('gregale jobs run nightly-report --tasks 1');
  });

  // commands_jobs.go cmdJobsRm: "usage: gregale jobs rm <name>"
  it('removes a job by name', () => {
    expect(cliJobRemoveCommand('nightly-report')).toBe('gregale jobs rm nightly-report');
  });
});

describe('object storage commands', () => {
  const bucket = '0b6f3a52-6c1c-4a4e-9d57-0c5b1e8d6a11';

  // commands_bucket_versioning.go bucketVersioningUsage:
  //   "usage: gregale bucket versioning <status|enable|suspend> <app> <bucket-id>"
  it('reads versioning with status, which the same command can then enable or suspend', () => {
    expect(cliBucketVersioningCommand('my-api', bucket)).toBe(
      `gregale bucket versioning status my-api ${bucket}`
    );
  });

  // commands_bucket_lifecycle.go cmdBucketLifecycle:
  //   "usage: gregale bucket lifecycle <get|clear|scan> <app> <bucket-id> | set <app> <bucket-id> <JSON-file|-> | status <app> <bucket-id> <scan-id>"
  it('reads lifecycle rules with get', () => {
    expect(cliBucketLifecycleCommand('my-api', bucket)).toBe(
      `gregale bucket lifecycle get my-api ${bucket}`
    );
  });

  // commands_bucket_encryption.go bucketDefaultEncryptionUsage:
  //   "usage: gregale bucket encryption <status|clear|AES256|aws:kms|aws:kms:dsse> <app> <bucket-id> [owned-key-ref] [bucket-key-enabled]"
  it('reads default encryption with status', () => {
    expect(cliBucketEncryptionCommand('my-api', bucket)).toBe(
      `gregale bucket encryption status my-api ${bucket}`
    );
  });

  // commands_bucket_object_lock.go bucketObjectLockUsage:
  //   "usage: gregale bucket object-lock <status|capabilities|enable|clear-default|GOVERNANCE|COMPLIANCE> <app> <bucket-id> [--days N | --years N] [--event-days N | --event-years N]"
  it('reads Object Lock with status', () => {
    expect(cliBucketObjectLockCommand('my-api', bucket)).toBe(
      `gregale bucket object-lock status my-api ${bucket}`
    );
  });

  // commands_bucket_uploads.go cmdBucketUploads:
  //   "usage: gregale bucket uploads list <app> <bucket-id> [--limit N] [--cursor ID] | gregale bucket uploads <status|parts> <app> <bucket-id> <upload-id>"
  it('lists in-progress multipart uploads', () => {
    expect(cliBucketUploadsCommand('my-api', bucket)).toBe(
      `gregale bucket uploads list my-api ${bucket}`
    );
  });

  it('keeps readable placeholders for an app or bucket that is not chosen yet', () => {
    expect(cliBucketVersioningCommand('my-api')).toBe(
      'gregale bucket versioning status my-api <bucket-id>'
    );
    expect(cliBucketVersioningCommand(undefined, undefined)).toBe(
      'gregale bucket versioning status <app> <bucket-id>'
    );
  });
});

describe('postgres restore command', () => {
  // commands_postgres.go cmdPostgresRestore:
  //   "usage: gregale postgres restore DATABASE_ID --name NAME --point-in-time RFC3339"
  // DATABASE_ID may also be the database name (postgresDatabaseID resolves either).
  it('names the source database, the new name and the RFC3339 point in time', () => {
    expect(cliPostgresRestoreCommand('db-1', 'orders-restored', '2026-10-20T09:30:00.000Z')).toBe(
      'gregale postgres restore db-1 --name orders-restored --point-in-time 2026-10-20T09:30:00.000Z'
    );
  });

  it('keeps placeholders until the form has a name and a time', () => {
    expect(cliPostgresRestoreCommand('db-1')).toBe(
      'gregale postgres restore db-1 --name <new-name> --point-in-time <RFC3339-time>'
    );
  });

  it('quotes a typed name the shell would split, and leaves safe names bare', () => {
    expect(cliPostgresRestoreCommand('db-1', 'my copy; rm -rf ~', '2026-10-20T09:30:00Z')).toBe(
      "gregale postgres restore db-1 --name 'my copy; rm -rf ~' --point-in-time 2026-10-20T09:30:00Z"
    );
    expect(cliPostgresRestoreCommand('db-1', "it's", '2026-10-20T09:30:00Z')).toBe(
      "gregale postgres restore db-1 --name 'it'\\''s' --point-in-time 2026-10-20T09:30:00Z"
    );
  });
});

describe('domain commands', () => {
  // commands2.go cmdDomains: "usage: gregale domains set-default <domain>"
  it('makes a domain its app default', () => {
    expect(cliDomainSetDefaultCommand('api.example.com')).toBe(
      'gregale domains set-default api.example.com'
    );
  });
});

describe('cliPreAuthCommand', () => {
  // cmd/gregale/app_pre_auth.go:39-41: observe and enforce need
  // --pre-auth-rps and --pre-auth-burst of at least 1 when nothing is stored.
  it('names a rate and burst when turning the guard on', () => {
    expect(cliPreAuthCommand('api', 'observe', { rps: 10, burst: 20 })).toBe(
      'gregale app api --pre-auth observe --pre-auth-rps 10 --pre-auth-burst 20'
    );
  });
  it('switches an existing guard to enforce without restating its rate', () => {
    expect(cliPreAuthCommand('api', 'enforce')).toBe('gregale app api --pre-auth enforce');
  });
});
