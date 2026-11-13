import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { UserModel } from './auth.model';
import { NotFoundError } from '../../core/errors/app-error';

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.register(req.body);
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body);
      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async googleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.googleLogin(req.body);
      res.status(200).json({
        success: true,
        message: 'Google login successful',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const user = UserModel.findById(userId);
      if (!user) {
        throw new NotFoundError('User profile not found');
      }

      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          apiKey: user.api_key,
          createdAt: user.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async regenerateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.userId;
      const newKey = AuthService.regenerateApiKey(userId);
      res.status(200).json({
        success: true,
        message: 'API Key regenerated successfully',
        data: { apiKey: newKey },
      });
    } catch (error) {
      next(error);
    }
  }
}

