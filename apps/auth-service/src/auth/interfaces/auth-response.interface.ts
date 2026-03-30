export interface PublicUser {
  id: string;
  email: string;
  status: string;
  systemRole: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  dob: Date | null;
  address: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  locale: string | null;
  fullName: string | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  session: {
    sid: string;
  };
  user: PublicUser;
}
