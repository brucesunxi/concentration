/** Pure guards for the family-members invite UI. Invitee username/password stay on the join form per family-members-1. */
export type InviteDraftStep = 'select' | 'confirm';

export function canReviewInvite(selectedChildIds: string[], acknowledged: boolean): boolean {
  return acknowledged && selectedChildIds.length > 0 && selectedChildIds.length <= 3 && new Set(selectedChildIds).size === selectedChildIds.length;
}

export function canSubmitInvite(input: {
  step: InviteDraftStep;
  selectedChildIds: string[];
  confirmAcknowledged: boolean;
  codeShowing: boolean;
  busy: boolean;
}): boolean {
  return input.step === 'confirm'
    && canReviewInvite(input.selectedChildIds, true)
    && input.confirmAcknowledged
    && !input.codeShowing
    && !input.busy;
}
