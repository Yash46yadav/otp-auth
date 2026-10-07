# Email OTP Authentication (React + Express + MySQL)

## Setup
1. **Database:** run `backend/schema.sql` in MySQL (Workbench or `mysql -u root -p < backend/schema.sql`).
2. **Backend:**
   ```
   cd backend
   cp .env.example .env     # fill in DB + Gmail App Password + JWT secret
   npm install
   npm run dev
   ```
3. **Frontend:**
   ```
   cd frontend
   npm install
   npm run dev              # opens http://localhost:5173
   ```

## Flows
- **Sign up:** details -> OTP emailed -> verify -> account active
- **Login:** email + password -> OTP emailed -> verify -> JWT issued
- **Forgot password:** email -> OTP -> reset token (10 min) -> new password

## Security features (talking points)
- Passwords hashed with bcrypt; OTPs stored hashed, expire in 10 min, single use
- OTP generated with crypto.randomInt (cryptographically secure)
- Max 5 wrong attempts per OTP; 60s resend cooldown; rate limit on /api/auth
- Same error for wrong email/password and same response on forgot-password (no email enumeration)
- Reset requires a short-lived JWT that only exists after OTP verification
- Secrets in .env (never commit it; add .gitignore)
