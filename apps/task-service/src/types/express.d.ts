import "express-serve-static-core";
import type { JwtUser } from "../common/interfaces/jwt-user.interface";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    user?: JwtUser;
  }
}
