import { getDatabase } from '../../config/database';

export interface UserEntity {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: 'ADMIN' | 'ANALYST' | 'OPERATOR';
  api_key: string | null;
  created_at: string;
}

export class UserModel {
  private static get db() {
    return getDatabase();
  }

  static create(user: Omit<UserEntity, 'created_at'>): UserEntity {
    const query = this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, api_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    query.run(user.id, user.username, user.email, user.password_hash, user.role, user.api_key);
    return this.findById(user.id)!;
  }

  static findById(id: string): UserEntity | null {
    const query = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return (query.get(id) as UserEntity) || null;
  }

  static findByEmail(email: string): UserEntity | null {
    const query = this.db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)');
    return (query.get(email) as UserEntity) || null;
  }

  static findByUsername(username: string): UserEntity | null {
    const query = this.db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)');
    return (query.get(username) as UserEntity) || null;
  }

  static findByApiKey(apiKey: string): UserEntity | null {
    const query = this.db.prepare('SELECT * FROM users WHERE api_key = ?');
    return (query.get(apiKey) as UserEntity) || null;
  }

  static updateApiKey(id: string, apiKey: string): void {
    const query = this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?');
    query.run(apiKey, id);
  }

  static count(): number {
    const query = this.db.prepare('SELECT COUNT(*) as count FROM users');
    return (query.get() as { count: number }).count;
  }
}

