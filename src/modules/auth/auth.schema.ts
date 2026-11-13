import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric or underscore'),
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  role: z.enum(['ADMIN', 'ANALYST', 'OPERATOR']).default('ANALYST'),
});

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(3),
  password: z.string().min(1),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(10, 'Google credential token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

