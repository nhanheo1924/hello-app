import { Controller, Get } from '@nestjs/common';
import { JwtKeyService } from './jwt-key.service';

@Controller('.well-known')
export class JwksController {
  constructor(private readonly jwtKeyService: JwtKeyService) {}

  @Get('jwks.json')
  getJwks() {
    return this.jwtKeyService.getJwks();
  }
}
