import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { JwtUser } from "../interfaces/jwt-user.interface";

export const CurrentUser = createParamDecorator(
  (field: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      return undefined as unknown as JwtUser;
    }

    if (!field) {
      return user;
    }

    return user[field];
  },
);
