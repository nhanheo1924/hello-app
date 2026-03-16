import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtKeyService } from './jwt-key.service';
import { JwksController } from './jwks.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({}),
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AuthController, JwksController],
  providers: [AuthService, JwtStrategy, JwtKeyService],
  exports: [AuthService, JwtKeyService],
})
export class AuthModule {}
