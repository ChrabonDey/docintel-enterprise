# Authentication & Security Architecture Guide
*(Interview Preparation & Implementation Deep-Dive)*

> **User Requirement Note:**
> *"Kemne ki authentication korsos egula ask kora hobe"* — This document is specifically written to provide an exhaustive, confident explanation of the system's authentication and authorization architecture for technical interviews and audits.

---

## 1. High-Level Authentication Architecture

Our system implements a **dual-tier, enterprise-grade authentication and authorization mechanism**:
1. **Interactive Session Layer:** JSON Web Tokens (JWT) using the `Bearer <token>` HTTP header scheme with `HS256` (HMAC with SHA-256) signature.
2. **Machine-to-Machine (M2M) API Layer:** Cryptographically secure API keys (`doc_key_<hex>`) via the `X-API-KEY` HTTP header for automated ERP/billing system integrations.
3. **Role-Based Access Control (RBAC):** Three discrete privilege tiers (`ADMIN`, `ANALYST`, `OPERATOR`) enforced via modular Express route guards.

```
+---------------------------------------------------------------------------------------+
|                                    INCOMING REQUEST                                   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
                   +-----------------------------------------------+
                   |          authenticate Middleware              |
                   +-----------------------------------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
          Has 'X-API-KEY' header?                     Has 'Authorization' header?
                    |                                             |
                    v                                             v
        [Lookup UserModel by Key]                      [Extract 'Bearer <token>']
                    |                                             |
          Valid API Key in DB?                        Verify JWT signature (HS256)
             /            \                                 /            \
          Yes              No                             Valid        Invalid/Expired
           |                |                               |                |
           v                v                               v                v
   [Attach req.user]  [401 Unauthorized]             [Attach req.user] [401 Unauthorized]
           |                                                |
           +-----------------------+------------------------+
                                   |
                                   v
                   +-------------------------------+
                   |    authorizeRoles Middleware  |
                   |   (e.g., ADMIN, ANALYST)      |
                   +-------------------------------+
                                   |
                     User's role in allowed list?
                                /      \
                             Yes        No
                              |          |
                              v          v
                        [Next Route] [403 Forbidden]
```

---

## 2. Step-by-Step Implementation Details

### Step 1: Password Security with Salted Bcrypt
Passwords are **never stored in plaintext**.
- **Library:** `bcryptjs`
- **Salt Rounds:** `10` rounds of algorithmic salt generation.
- **Resistance:** Defends against rainbow table attacks and precomputed dictionary attacks.
- **Code Reference:** `src/modules/auth/auth.service.ts`:
  ```typescript
  const saltRounds = 10;
  const password_hash = await bcrypt.hash(input.password, saltRounds);
  ```

### Step 2: JWT Token Construction & Verification
- **Claims Stored in Payload:**
  - `userId`: Unique UUIDv4 identifier.
  - `username`: Alphanumeric display handle.
  - `email`: Normalized lowercase email.
  - `role`: One of `'ADMIN' | 'ANALYST' | 'OPERATOR'`.
- **Secret & Expiry:** Signed with `env.JWT_SECRET` using standard `HS256` algorithm, expiring in `24h` (configurable via `env.JWT_EXPIRES_IN`).
- **Signature Verification:**
  ```typescript
  jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  ```
- **Error Handling:** Explicitly differentiates between `TokenExpiredError` (prompting client token refresh) and malformed signatures.

### Step 3: Programmatic API Keys (M2M)
For automated background workers, ETL pipelines, and cross-system uploads:
- Generated using Node's cryptographic PRNG:
  ```typescript
  const apiKey = `doc_key_${crypto.randomBytes(24).toString('hex')}`;
  ```
- Indexed in the database (`CREATE UNIQUE INDEX idx_users_api_key`) for sub-millisecond lookup.

### Step 4: Role-Based Access Control (RBAC)
We enforce least-privilege access across all sensitive resources:

| Role | Permissions & Capabilities | Protected Endpoints |
| :--- | :--- | :--- |
| **`ADMIN`** | Full platform control: upload, inspect, cross-verify, manual correction, re-queue failed jobs, regenerate keys. | `ALL` endpoints |
| **`ANALYST`** | Financial review: inspect documents, review validation math errors, apply manual corrections with audit logging, run cross-verification. | `PUT /documents/:id/corrections`, `POST /documents/cross-verify` |
| **`OPERATOR`** | Ingestion & Search: upload document batches, check real-time processing status, query documents. | `POST /documents/upload`, `GET /documents`, `GET /search` |

---

## 3. Interview Q&A (Bengali & English) — কি কি জিজ্ঞেস করতে পারে এবং কিভাবে উত্তর দিবা

### Q1: "Authentication টা কিভাবে implement করছ?" (How did you implement Authentication?)
> **Bangla Answer:**
> "আমি আমাদের সিস্টেমে **JWT (JSON Web Token)** এবং **Bcrypt password hashing** দিয়ে stateless token-based authentication implement করেছি। সাথে headless বা third-party programmatic access এর জন্য **API Key** সাপোর্টও রেখেছি।
> ইউজার রেজিস্ট্রেশনের সময় পাসওয়ার্ডকে ১০ salt rounds দিয়ে hash করে SQLite ডাটাবেসে সেভ করা হয়। লগিনের সময় `bcrypt.compare()` দিয়ে পাসওয়ার্ড ভ্যালিডেট করে HMAC-SHA256 অ্যালগরিদম দিয়ে সাইন করা একটি JWT Bearer Token রিটার্ন করি।
> এক্সপ্রেসের জন্য আমরা কাস্টম `authenticate` মিডলওয়্যার বানিয়েছি যা প্রতিটি ইনকামিং রিকোয়েস্টের `Authorization: Bearer <token>` হেডার অথবা `X-API-KEY` হেডার চেক করে। টোকেন ভ্যালিড হলে পে-লোড থেকে `userId`, `username`, এবং `role` এক্সট্র্যাক্ট করে `req.user`-এ বাইন্ড করে দেয়।
> এছাড়া Role-Based Access Control (RBAC) এর জন্য `authorizeRoles('ADMIN', 'ANALYST')` মিডলওয়্যার আছে, যাতে শুধু অথোরাইজড রোলরাই ম্যানুয়াল কারেকশন বা রি-প্রসেসিং করতে পারে।"

### Q2: "JWT ক্যান ইউজ করলা? Session-based ক্যান করো নাই?" (Why JWT over Session-based Auth?)
> **Bangla Answer:**
> "আমাদের ব্যাকএন্ডে হাজার হাজার ডকুমেন্ট প্রসেস করার জন্য background worker queue এবং asynchronous job pipeline রয়েছে। JWT হলো **stateless**, যার ফলে ব্যাকএন্ড ক্লাস্টার স্কেল করলে প্রতিবার সেন্ট্রালাইজড সেশন স্টোর (যেমন Redis session store) এ রিড কল দেওয়ার ওভারহেড থাকে না। টোকেন নিজেই সেলফ-কন্টেইন্ড এবং ক্রিপ্টোগ্রাফিক্যালি সাইনড, তাই অত্যন্ত দ্রুত এবং অনুভূমিকভাবে স্কেল (horizontal scaling) করা যায়।"

### Q3: "API Key আর JWT এর মধ্যে পার্থক্য কি এই সিস্টেমে?" (Difference between API Key and JWT in your system?)
> **Bangla Answer:**
> "JWT সাধারণত ক্লায়েন্ট ব্রাউজার বা ফ্রন্টএন্ড সিঙ্গেল পেজ অ্যাপ্লিকেশন (SPA) থেকে ইউজারের ইন্টারেক্টিভ সেশনের জন্য ব্যবহৃত হয় এবং এর একটা ফিক্সড এক্সপায়ারি টাইম (`24h`) থাকে।
> অন্যদিকে, `API Key` মূলত মেশিন-টু-মেশিন (M2M) ইন্টিগ্রেশনের জন্য (যেমন ERP সিস্টেম বা автоматик পাইপলাইন থেকে ডকুমেন্ট পুশ করার জন্য)। এটি `X-API-KEY` হেডারে পাঠানো হয় এবং ইউজার চাইলে যেকোনো সময় ড্যাশবোর্ড থেকে রি-জেনারেট করতে পারে।"

### Q4: "Manual Correction এর ক্ষেত্রে সিকিউরিটি এবং অডিট কিভাবে মেনটেইন করছ?" (How do you secure manual corrections?)
> **Bangla Answer:**
> "ম্যানুয়াল কারেকশন এন্ডপয়েন্ট (`PUT /api/v1/documents/:id/corrections`) শুধুমাত্র `ADMIN` এবং `ANALYST` রোলের জন্য রেস্ট্রিক্টেড। যখন কোনো অডিটর ভ্যালু কারেক্ট করেন, তখন Zod ভ্যালিডেশন দিয়ে একটা বাধ্যতামূলক `reason` স্ট্রিং নেওয়া হয়।
> এরপর সিস্টেমে একটি `audit_logs` টেবিল আছে, যেখানে অডিটরের `user_id`, কোন ফিল্ডটি পরিবর্তন হলো, আগের ভ্যালু (`old_value`), নতুন ভ্যালু (`new_value`), এবং পরিবর্তনের কারণ (`reason`) টাইমস্ট্যাম্প সহ ইমিউটেবলি স্টোর হয়। এর ফলে কেউ কোনো ডেটা ম্যানিপুলেট করলে তার সম্পূর্ণ ট্রেসেবিলিটি ডাটাবেসে থাকে।"

---

## 4. Default Seeded Credentials for Testing

| Username | Email | Password | Role | Master API Key |
| :--- | :--- | :--- | :--- | :--- |
| `admin` | `admin@docintel.com` | `AdminPass123!` | `ADMIN` | `doc_key_admin_super_secret_master_token_2026` |
| `analyst` | `analyst@docintel.com` | `AnalystPass123!` | `ANALYST` | `doc_key_analyst_review_token_2026` |

