import {
  changePassword,
  getCurrentUser,
  updateProfile,
} from '../../core/auth/auth-api';

export async function getMyProfile() {
  return getCurrentUser({ forceRefresh: true });
}

export async function updateMyProfile(payload: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  dob?: string;
  address?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
  fullName?: string;
}) {
  return updateProfile(payload);
}

export async function changeMyPassword(payload: {
  currentPassword: string;
  newPassword: string;
  otp?: string;
  backupCode?: string;
}) {
  return changePassword(payload);
}
