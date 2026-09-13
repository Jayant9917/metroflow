import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { RegisterDto } from './register.dto';
import { AuthService } from './auth.service';
@Controller('api/v1/auth') export class AuthController { constructor(private readonly auth: AuthService) {} @Post('register') @HttpCode(201) register(@Body() dto: RegisterDto) { return this.auth.register(dto); } @Post('login') async login(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: any) { const result = await this.auth.login(dto); res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/auth/refresh', maxAge: 2592000000 }); return { accessToken: result.accessToken, user: result.user }; } }
