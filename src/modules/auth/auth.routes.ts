import { Router } from 'express';
import { AuthController } from './auth.controller';
import { validateBody } from '../../core/middleware/zod.middleware';
import { authenticate } from '../../core/middleware/auth.middleware';
import { registerSchema, loginSchema, googleAuthSchema } from './auth.schema';

const router = Router();

// Public routes
router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);
router.post('/google', validateBody(googleAuthSchema), AuthController.googleLogin);

// Protected routes (requires Bearer token or API key)
router.get('/me', authenticate, AuthController.getProfile);
router.post('/api-key/regenerate', authenticate, AuthController.regenerateApiKey);

export const authRoutes = router;

