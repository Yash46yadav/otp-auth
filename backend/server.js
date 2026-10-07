require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendOtp, verifyOtp } = require('./otp');

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// Global brute-force protection for all auth routes
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();

// Password rules. The frontend checks these too, but the frontend can be
// bypassed (Postman, curl), so the server is the one that really enforces them.
// Returns an error message if a rule is broken, otherwise null.
const passwordError = (p) => {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters.';
  if (!/^[A-Z]/.test(p)) return 'Password must start with a capital letter.';
  if (!/[^A-Za-z0-9\s]/.test(p)) return 'Password must include a special character such as _ or #.';
  return null;
};

const bad = (res, msg, code = 400) => res.status(code).json({ message: msg });

// Wrap async handlers so thrown errors reach the error handler
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

// ---------- SIGN UP ----------
app.post('/api/auth/signup', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = normEmail(req.body.email);
  const { password, confirmPassword } = req.body;

  if (!name || !EMAIL_RE.test(email)) return bad(res, 'Enter a valid name and email.');
  const pwErr = passwordError(password);
  if (pwErr) return bad(res, pwErr);
  // Server-side match check (the browser checks too, but it can be bypassed)
  if (password !== confirmPassword) return bad(res, 'Passwords do not match.');

  const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
  if (rows.length && rows[0].is_verified) return bad(res, 'This email is already registered.', 409);

  const hash = await bcrypt.hash(password, 10);
  if (rows.length) {
    // Unverified account re-registering: refresh details
    await db.query('UPDATE users SET name=?, password_hash=? WHERE email=?', [name, hash, email]);
  } else {
    await db.query('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)', [name, email, hash]);
  }
  await sendOtp(email, 'signup');
  res.json({ message: 'We sent a 6-digit code to your email.' });
}));

app.post('/api/auth/verify-signup', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  if (!(await verifyOtp(email, 'signup', req.body.otp))) return bad(res, 'Invalid or expired code.');
  await db.query('UPDATE users SET is_verified=1 WHERE email=?', [email]);
  res.json({ message: 'Account verified. You can now log in.' });
}));

// ---------- LOGIN (email + password only, no OTP) ----------
app.post('/api/auth/login', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
  const user = rows[0];

  // Same message for "no user" and "wrong password": no email enumeration
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash)))
    return bad(res, 'Incorrect email or password.', 401);
  if (!user.is_verified) return bad(res, 'Please verify your email first.', 403);

  // Password is correct and the email was verified at signup -> issue the token.
  // Send only safe fields (never password_hash).
  const safeUser = { id: user.id, name: user.name, email: user.email };
  res.json({ token: signToken(safeUser), user: safeUser });
}));

// ---------- FORGOT PASSWORD ----------
app.post('/api/auth/forgot-password', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const [rows] = await db.query('SELECT id FROM users WHERE email=? AND is_verified=1', [email]);
  if (rows.length) {
    try { await sendOtp(email, 'reset'); }
    catch (e) { if (e.status === 429) return bad(res, e.message, 429); throw e; }
  }
  // Always the same answer, whether or not the email exists
  res.json({ message: 'If this email is registered, a code has been sent.' });
}));

app.post('/api/auth/verify-reset-otp', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  if (!(await verifyOtp(email, 'reset', req.body.otp))) return bad(res, 'Invalid or expired code.');
  // Short-lived token proves OTP step was passed
  const resetToken = jwt.sign({ email, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ resetToken });
}));

app.post('/api/auth/reset-password', wrap(async (req, res) => {
  const { resetToken, newPassword, confirmPassword } = req.body;
  const newPwErr = passwordError(newPassword);
  if (newPwErr) return bad(res, newPwErr);
  if (newPassword !== confirmPassword) return bad(res, 'Passwords do not match.');
  let payload;
  try { payload = jwt.verify(resetToken, process.env.JWT_SECRET); }
  catch { return bad(res, 'Reset session expired. Start again.', 401); }
  if (payload.purpose !== 'reset') return bad(res, 'Invalid token.', 401);

  const hash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password_hash=? WHERE email=?', [hash, payload.email]);
  await db.query('DELETE FROM otps WHERE email=?', [payload.email]);
  res.json({ message: 'Password updated. Please log in.' });
}));

// ---------- RESEND OTP ----------
app.post('/api/auth/resend-otp', wrap(async (req, res) => {
  const email = normEmail(req.body.email);
  const { purpose } = req.body;
  if (!['signup', 'reset'].includes(purpose)) return bad(res, 'Invalid request.');
  const [rows] = await db.query('SELECT id FROM users WHERE email=?', [email]);
  if (rows.length) await sendOtp(email, purpose);
  res.json({ message: 'If this email is registered, a new code has been sent.' });
}));

// ---------- PROTECTED ROUTE EXAMPLE ----------
const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { bad(res, 'Not authorised.', 401); }
};
app.get('/api/me', auth, wrap(async (req, res) => {
  const [rows] = await db.query('SELECT id, name, email FROM users WHERE id=?', [req.user.id]);
  res.json(rows[0]);
}));

// ---------- ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.status ? err.message : 'Something went wrong.' });
});

app.listen(process.env.PORT || 5000, () => console.log('API running on port', process.env.PORT || 5000));