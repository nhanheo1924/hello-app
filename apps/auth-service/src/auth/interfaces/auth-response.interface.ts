export interface PublicUser {
  id: string;
  email: string;
  status: string;
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
