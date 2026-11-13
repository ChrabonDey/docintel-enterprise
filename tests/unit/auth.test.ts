import { describe, it, expect, beforeAll } from 'bun:test';
import { AuthService } from '../../src/modules/auth/auth.service';
import { getDatabase } from '../../src/config/database';
import { UnauthorizedError } from '../../src/core/errors/app-error';

describe('Authentication Unit Tests', () => {
  beforeAll(() => {
    getDatabase(); // ensure DB initialized
  });

  const testUser = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: 'SecurePassword123!',
    role: 'ANALYST' as const,
  };

  it('should register a new user with hashed password and JWT token', async () => {
    const authRes = await AuthService.register(testUser);

    expect(authRes.user.username).toBe(testUser.username);
    expect(authRes.user.email).toBe(testUser.email);
    expect(authRes.user.role).toBe('ANALYST');
    expect(typeof authRes.token).toBe('string');
    expect(authRes.token.length).toBeGreaterThan(20);
    expect(authRes.user.apiKey).toContain('doc_key_');
  });

  it('should login an existing user with valid credentials', async () => {
    const loginRes = await AuthService.login({
      usernameOrEmail: testUser.email,
      password: testUser.password,
    });

    expect(loginRes.user.username).toBe(testUser.username);
    expect(typeof loginRes.token).toBe('string');
  });

  it('should reject login with incorrect password', async () => {
    expect(
      AuthService.login({
        usernameOrEmail: testUser.email,
        password: 'WrongPassword!',
      })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('should verify and decode valid JWT tokens', () => {
    const token = AuthService.generateToken({
      id: 'usr-1',
      username: 'john',
      email: 'john@example.com',
      password_hash: 'hash',
      role: 'ADMIN',
      api_key: 'key',
      created_at: new Date().toISOString(),
    });

    const payload = AuthService.verifyToken(token);
    expect(payload.userId).toBe('usr-1');
    expect(payload.username).toBe('john');
    expect(payload.role).toBe('ADMIN');
  });

  it('should reject forged or corrupted JWT tokens', () => {
    expect(() => AuthService.verifyToken('forged.invalid.token')).toThrow(UnauthorizedError);
  });
});

