import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../../config/env.config';
import { ConflictError, UnauthorizedError, BadRequestError } from '../../core/errors/app-error';
import { UserModel, type UserEntity } from './auth.model';
import type { RegisterInput, LoginInput, GoogleAuthInput } from './auth.schema';
import { logger } from '../../core/logger';

export interface TokenPayload {
  userId: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'ANALYST' | 'OPERATOR';
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    apiKey: string | null;
  };
  token: string;
  expiresIn: string;
}

export class AuthService {
  /**
   * Registers a new user with hashed password and generated API Key.
   */
  static async register(input: RegisterInput): Promise<AuthResponse> {
    const existingEmail = UserModel.findByEmail(input.email);
    if (existingEmail) {
      throw new ConflictError('A user with this email address already exists');
    }

    const existingUsername = UserModel.findByUsername(input.username);
    if (existingUsername) {
      throw new ConflictError('A user with this username already exists');
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(input.password, saltRounds);
    const apiKey = `doc_key_${crypto.randomBytes(24).toString('hex')}`;

    const newUser = UserModel.create({
      id: uuidv4(),
      username: input.username,
      email: input.email,
      password_hash,
      role: input.role,
      api_key: apiKey,
    });

    const token = this.generateToken(newUser);

    return {
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        apiKey: newUser.api_key,
      },
      token,
      expiresIn: env.JWT_EXPIRES_IN,
    };
  }

  /**
   * Authenticates user via email/username and password.
   */
  static async login(input: LoginInput): Promise<AuthResponse> {
    const user =
      UserModel.findByEmail(input.usernameOrEmail) ||
      UserModel.findByUsername(input.usernameOrEmail);

    if (!user) {
      throw new UnauthorizedError('Invalid username/email or password');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid username/email or password');
    }

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        apiKey: user.api_key,
      },
      token,
      expiresIn: env.JWT_EXPIRES_IN,
    };
  }

  /**
   * Authenticates user via Google OAuth Identity Token.
   * Auto-provisions account if user is logging in for the first time.
   */
  static async googleLogin(input: GoogleAuthInput): Promise<AuthResponse> {
    try {
      // Decode JWT token from Google identity service
      const decoded: any = jwt.decode(input.credential);
      if (!decoded || !decoded.email) {
        throw new BadRequestError('Invalid or corrupted Google credential payload');
      }

      const email = decoded.email.toLowerCase();
      const name = decoded.name || decoded.given_name || email.split('@')[0];
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');

      // Check if user already exists
      let user = UserModel.findByEmail(email);

      if (!user) {
        logger.info(`Creating new user account for Google sign-in: ${email}`);
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const password_hash = await bcrypt.hash(randomPassword, 10);
        const apiKey = `doc_key_${crypto.randomBytes(24).toString('hex')}`;

        // Ensure unique username
        let uniqueUsername = username;
        if (UserModel.findByUsername(uniqueUsername)) {
          uniqueUsername = `${username}_${crypto.randomBytes(4).toString('hex')}`;
        }

        user = UserModel.create({
          id: uuidv4(),
          username: uniqueUsername,
          email,
          password_hash,
          role: 'ANALYST',
          api_key: apiKey,
        });
      }

      const token = this.generateToken(user);

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          apiKey: user.api_key,
        },
        token,
        expiresIn: env.JWT_EXPIRES_IN,
      };
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      logger.error('Google OAuth processing failed:', err);
      throw new UnauthorizedError('Google authentication verification failed');
    }
  }

  /**
   * Generates a signed JWT bearer token.
   */
  static generateToken(user: UserEntity): string {
    const payload: TokenPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as any,
      algorithm: 'HS256',
    });
  }

  /**
   * Verifies and decodes a JWT token.
   */
  static verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Authentication token has expired. Please log in again.');
      }
      throw new UnauthorizedError('Invalid authentication token');
    }
  }

  /**
   * Regenerates a new API Key for programmatic access.
   */
  static regenerateApiKey(userId: string): string {
    const newApiKey = `doc_key_${crypto.randomBytes(24).toString('hex')}`;
    UserModel.updateApiKey(userId, newApiKey);
    return newApiKey;
  }
}

