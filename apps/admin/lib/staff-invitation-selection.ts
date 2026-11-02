import {
  validateStaffInvitationIntent,
  type StaffBranchPage,
  type StaffInvitationIntent,
} from '@realtor/domain';

/** A retained selection must still be visible and active on the reviewed page. */
export function staffInvitationIntentForPage(
  page: StaffBranchPage,
  input: StaffInvitationIntent,
): StaffInvitationIntent {
  const command = validateStaffInvitationIntent(input);
  if (
    command.branchId !== null &&
    !page.items.some((branch) => branch.branchId === command.branchId && branch.active)
  )
    throw Error('Choose an active branch from the current page or explicitly choose company-wide.');
  return command;
}
