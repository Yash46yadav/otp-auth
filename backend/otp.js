// Everything about creating, emailing and verifying OTPs lives here.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const db = require('./db');

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 10;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
});

const SUBJECTS = {
  signup: 'Verify your email',
  login: 'Your login code',
  reset: 'Reset your password',
};

// Create an OTP, store ONLY its hash, email the plain code.
async function sendOtp(email, purpose) {
  // Cooldown: block spamming the "resend" button
  const [recent] = await db.query(
    `SELECT created_at FROM otps WHERE email=? AND purpose=?
     ORDER BY id DESC LIMIT 1`, [email, purpose]);
  if (recent.length) {
    const age = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    if (age < RESEND_COOLDOWN_SEC) {
      const wait = Math.ceil(RESEND_COOLDOWN_SEC - age);
      const err = new Error(`Please wait ${wait}s before requesting a new code.`);
      err.status = 429;
      throw err;
    }
  }

  const otp = crypto.randomInt(100000, 1000000).toString(); // secure 6 digits
  const otpHash = await bcrypt.hash(otp, 10);

  // Only one active OTP per email+purpose
  await db.query('DELETE FROM otps WHERE email=? AND purpose=?', [email, purpose]);
  await db.query(
    `INSERT INTO otps (email, otp_hash, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [email, otpHash, purpose, OTP_MINUTES]);


// This code sends the generated OTP to the user's email with its purpose and expiry information.
  await transporter.sendMail({
    from: `"Auth App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: SUBJECTS[purpose],
    text: `Your code is ${otp}. It expires in ${OTP_MINUTES} minutes. If you didn't request it, ignore this email.`,
  });
}

// Returns true if OTP is valid. Deletes it on success (single-use).
async function verifyOtp(email, purpose, otp) {
  const [rows] = await db.query(
    `SELECT * FROM otps WHERE email=? AND purpose=? AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`, [email, purpose]);
  if (!rows.length) return false;
  const rec = rows[0];

  if (rec.attempts >= MAX_ATTEMPTS) {
    await db.query('DELETE FROM otps WHERE id=?', [rec.id]);
    return false;
  }
  const ok = await bcrypt.compare(String(otp), rec.otp_hash);
  if (!ok) {
    await db.query('UPDATE otps SET attempts = attempts + 1 WHERE id=?', [rec.id]);
    return false;
  }
  await db.query('DELETE FROM otps WHERE id=?', [rec.id]);
  return true;
}

module.exports = { sendOtp, verifyOtp };
