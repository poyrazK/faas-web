/** Only states accepted by the customer cancellation/retry API enable actions. */
export function deploymentRecovery(status: string) {
  if (['pending', 'building', 'imaging', 'snapshotting'].includes(status)) {
    return {
      kind: 'cancel' as const,
      explanation:
        'This attempt is still in progress and can be cancelled. The live release keeps serving.',
    };
  }
  if (status === 'failed') {
    return {
      kind: 'retry' as const,
      explanation:
        'Cancellation is unavailable because this attempt has failed. Retry creates a new attempt from its recorded source/image and release inputs.',
    };
  }
  const explanation =
    status === 'live'
      ? 'This release is live. Cancellation is unavailable and retry requires a failed release.'
      : status === 'superseded'
        ? 'This release has been replaced. Cancellation is unavailable and retry requires a failed release.'
        : status === 'cancelled'
          ? 'This release is already cancelled. Retry requires a failed release.'
          : `Recovery is unavailable for the unsupported deployment state “${status || 'unknown'}”.`;
  return { kind: 'unavailable' as const, explanation };
}
