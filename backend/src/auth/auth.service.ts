import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .exec();
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);
    const userId = randomUUID().replace(/-/g, '');

    const user = new this.userModel({
      user_id: userId,
      email: dto.email.toLowerCase(),
      full_name: dto.full_name,
      password_hash: passwordHash,
      role: 'student',
      provider: 'local',
      failed_login_attempts: 0,
      is_two_factor_enabled: false,
    });

    await user.save();
    
    const tokens = await this.generateTokens(user);

    return {
      message: 'Registration successful',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase() })
      .select('+password_hash +is_two_factor_enabled')
      .exec();
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.locked_until && user.locked_until > new Date()) {
      const waitTime = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 1000 / 60,
      );
      throw new UnauthorizedException(
        `Account is locked. Try again in ${waitTime} minutes.`,
      );
    }

    const passwordMatch = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!passwordMatch) {
      user.failed_login_attempts += 1;
      if (user.failed_login_attempts >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000);
      }
      await user.save();
      throw new UnauthorizedException('Invalid credentials');
    }

    user.failed_login_attempts = 0;
    user.locked_until = undefined;
    user.last_login = new Date();
    await user.save();

    const tokens = await this.generateTokens(user);

    return {
      message: 'Login successful',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async setup2fa(userId: string) {
    const user = await this.userModel.findOne({ user_id: userId }).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.is_two_factor_enabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      user.email,
      'SCPR App',
      secret
    );

    user.two_factor_secret = secret;
    await user.save();

    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return {
      secret,
      qr_code: qrCodeDataUrl,
    };
  }

  async verify2faSetup(userId: string, code: string) {
    const user = await this.userModel.findOne({ user_id: userId }).select('+two_factor_secret').exec();
    if (!user || !user.two_factor_secret) {
      throw new BadRequestException('2FA setup not initiated');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.two_factor_secret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    user.is_two_factor_enabled = true;
    
    // Generate recovery codes
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(4).toString('hex'));
    const hashedCodes = await Promise.all(
      recoveryCodes.map(code => bcrypt.hash(code, 10))
    );
    user.recovery_codes = hashedCodes;
    await user.save();

    const tokens = await this.generateTokens(user);

    return {
      message: '2FA setup successful',
      recovery_codes: recoveryCodes, // Only show once
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async verify2fa(userId: string, code: string) {
    const user = await this.userModel.findOne({ user_id: userId }).select('+two_factor_secret').exec();
    if (!user || !user.two_factor_secret) {
      throw new UnauthorizedException('2FA not enabled for this user');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.two_factor_secret,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    const tokens = await this.generateTokens(user);
    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async recoverAccount(email: string, recoveryCode: string, newPassword: string) {
    const user = await this.userModel.findOne({ email: email.toLowerCase() }).select('+recovery_codes').exec();
    if (!user || !user.recovery_codes || user.recovery_codes.length === 0) {
      throw new BadRequestException('Invalid recovery attempt');
    }

    let matchedIndex = -1;
    for (let i = 0; i < user.recovery_codes.length; i++) {
      const isMatch = await bcrypt.compare(recoveryCode, user.recovery_codes[i]);
      if (isMatch) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      throw new UnauthorizedException('Invalid recovery code');
    }

    // Remove the used recovery code
    user.recovery_codes.splice(matchedIndex, 1);

    // Set new password
    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(newPassword, salt);
    
    // Reset locks
    user.failed_login_attempts = 0;
    user.locked_until = undefined;

    await user.save();
    return { success: true, message: 'Password has been reset successfully.' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
      secret: process.env.JWT_REFRESH_SECRET,
      });
      const user = await this.userModel
        .findOne({ user_id: payload.sub })
        .exec();
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user);
      return tokens;
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(user: any) {
    return { success: true };
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.user_id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  sanitizeUser(user: any) {
    return {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_two_factor_enabled: user.is_two_factor_enabled,
      created_at: user.created_at || (user.get && user.get('created_at')),
      updated_at: user.updated_at || (user.get && user.get('updated_at')),
    };
  }
}
