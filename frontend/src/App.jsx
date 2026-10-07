import { useState, useEffect } from 'react';
import { api } from './api.js';
import TubesBackground from './TubesBackground.jsx';

// ============================================================
// SETTINGS YOU CAN CHANGE
// Seconds the user must wait before "Resend code" is enabled.
// Keep this equal to RESEND_COOLDOWN_SEC in backend/otp.js,
// otherwise the server will reject early resends.
const RESEND_SECONDS = 10;
// ============================================================

/* ---------- password rules (shared by signup and reset) ---------- */

// Each rule has a label (shown to the user) and a check (true = passed)
function passwordRules(p) {
  return [
    { label: 'At least 8 characters', ok: p.length >= 8 },
    { label: 'Starts with a capital letter', ok: /^[A-Z]/.test(p) },
    { label: 'Has a special character (like _ or #)', ok: /[^A-Za-z0-9\s]/.test(p) },
  ];
}

const allRulesPass = (p) => passwordRules(p).every((r) => r.ok);

/* ---------- small reusable pieces ---------- */

// Eye icons (inline SVG, so no extra library is needed)
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// Input with a label. Password inputs get their own show/hide eye button,
// and each one keeps its own on/off state (so the confirm field is independent).
function Field({ label, type, wrapClass, ...props }) {
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <label className="field">
      <span>{label}</span>
      <div className={'input-wrap' + (wrapClass ? ' ' + wrapClass : '')}>
        <input {...props} type={isPassword && show ? 'text' : type} className={isPassword ? 'has-eye' : undefined} />
        {/* onMouseDown preventDefault: clicking the eye must not take focus away from the input */}
        {isPassword && (
          <button type="button" className="eye" onMouseDown={(e) => e.preventDefault()} onClick={() => setShow(!show)}
            aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </label>
  );
}

// Live checklist: each rule turns green as soon as it is satisfied
function PasswordRules({ password }) {
  if (!password) return null;
  return (
    <ul className="rules">
      {passwordRules(password).map((r) => (
        <li key={r.label} className={r.ok ? 'ok' : ''}>{r.label}</li>
      ))}
    </ul>
  );
}

/* ---------- live "do the passwords match?" feedback ---------- */

// Works out one of four states from the two password boxes:
//   idle     -> confirm box is empty, show nothing
//   typing   -> what is typed so far is the START of the password, so no error yet
//   match    -> both are identical
//   mismatch -> they differ (or the user left the box before finishing)
function useMatchStatus(password, confirm) {
  const [blurred, setBlurred] = useState(false);
  let status = 'idle';
  if (confirm) {
    if (confirm === password) status = 'match';
    else if (password.startsWith(confirm) && !blurred) status = 'typing';
    else status = 'mismatch';
  }
  return { status, onFocus: () => setBlurred(false), onBlur: () => setBlurred(true) };
}

// CSS classes for the confirm input's wrapper (green glow / red shake)
const matchWrapClass = (status) =>
  status === 'match' ? 'match-ok' : status === 'mismatch' ? 'match-no shake' : '';

// The message under the confirm box. key={status} makes the animation replay on every change.
function MatchStatus({ status }) {
  const ok = status === 'match';
  const show = ok || status === 'mismatch';
  return (
    <div className="match-slot" role="status" aria-live="polite">
      {show && (
        <p key={status} className={'match ' + (ok ? 'ok' : 'no')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="ring" cx="12" cy="12" r="10" />
            <path className="mark" pathLength="1"
              d={ok ? 'M7 12.5l3.2 3.2L17 9' : 'M8.5 8.5l7 7M15.5 8.5l-7 7'} />
          </svg>
          <span>{ok ? 'Passwords match' : 'Passwords do not match'}</span>
        </p>
      )}
    </div>
  );
}

function Alert({ error, info }) {
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (info) return <p className="alert info">{info}</p>;
  return null;
}

// OTP entry + resend countdown, reused by signup and forgot password
function OtpStep({ email, purpose, onVerify, busy }) {
  const [otp, setOtp] = useState('');
  const [left, setLeft] = useState(RESEND_SECONDS);
  const [msg, setMsg] = useState({});

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const resend = async () => {
    try {
      await api('/auth/resend-otp', { email, purpose });
      setLeft(RESEND_SECONDS);
      setMsg({ info: 'A new code was sent.' });
    } catch (e) { setMsg({ error: e.message }); }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onVerify(otp); }}>
      <p className="hint">Enter the 6-digit code sent to <b>{email}</b>.</p>
      <Field label="Verification code" value={otp} inputMode="numeric" maxLength={6}
        placeholder="6-digit code" autoComplete="one-time-code" onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
      <Alert {...msg} />
      <button className="btn" disabled={busy || otp.length !== 6}>Verify code</button>
      <button type="button" className="link" onClick={resend} disabled={left > 0}>
        {left > 0 ? `Resend code in ${left}s` : 'Resend code'}
      </button>
    </form>
  );
}

/* ---------- screens ---------- */

function Signup({ go }) {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [step, setStep] = useState('form'); // form -> otp
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const match = useMatchStatus(f.password, f.confirm);

  const submit = async (e) => {
    e.preventDefault(); setMsg({});
    // Check on the frontend first so the user gets instant feedback
    if (!allRulesPass(f.password)) return setMsg({ error: 'Password does not meet all the rules below.' });
    if (f.password !== f.confirm) return setMsg({ error: 'Passwords do not match.' });

    setBusy(true);
    try {
      // The server checks that the two passwords match too, so it receives both
      await api('/auth/signup', { name: f.name, email: f.email, password: f.password, confirmPassword: f.confirm });
      setStep('otp');
    } catch (err) { setMsg({ error: err.message }); }
    setBusy(false);
  };
  const verify = async (otp) => {
    setBusy(true); setMsg({});
    try {
      await api('/auth/verify-signup', { email: f.email, otp });
      go('login', 'Account verified. Log in to continue.');
    } catch (err) { setMsg({ error: err.message }); }
    setBusy(false);
  };

  return (
    <>
      <h1>{step === 'form' ? 'Create your account' : 'Check your email'}</h1>
      {step === 'form' ? (
        <form onSubmit={submit}>
          {/* autoComplete="new-password" tells the browser this is a NEW account,
              so it must not pre-fill a saved password. */}
          <Field label="Full name" value={f.name} onChange={set('name')} placeholder="e.g. Your Name" autoComplete="name" required />
          <Field label="Email" type="email" value={f.email} onChange={set('email')} placeholder="you@example.com" autoComplete="off" required />
          <Field label="Password" type="password" value={f.password} onChange={set('password')} placeholder="Create a password" autoComplete="new-password" required />
          <PasswordRules password={f.password} />
          <Field label="Confirm password" type="password" value={f.confirm} onChange={set('confirm')} placeholder="Re-enter your password" autoComplete="new-password"
            wrapClass={matchWrapClass(match.status)} onFocus={match.onFocus} onBlur={match.onBlur} required />
          <MatchStatus status={match.status} />
          <Alert {...msg} />
          <button className="btn" disabled={busy}>{busy ? 'Sending code...' : 'Sign up'}</button>
        </form>
      ) : (
        <>
          <Alert error={msg.error} />
          <OtpStep email={f.email} purpose="signup" onVerify={verify} busy={busy} />
        </>
      )}
      <p className="switch">Already have an account? <button className="link" onClick={() => go('login')}>Log in</button></p>
    </>
  );
}

function Login({ go, onLoggedIn, notice }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [msg, setMsg] = useState({ info: notice });
  const [busy, setBusy] = useState(false);

  // Password only: the server checks it and sends back the login token directly.
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg({});
    try {
      const data = await api('/auth/login', f);
      onLoggedIn(data);
    } catch (err) { setMsg({ error: err.message }); setBusy(false); }
  };

  return (
    <>
      <h1>Welcome back</h1>
      <form onSubmit={submit}>
        {/* autoComplete off / new-password: stops Chrome pre-filling saved logins when the page opens */}
        <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@example.com" autoComplete="off" required />
        <Field label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="Enter your password" autoComplete="new-password" required />
        <Alert {...msg} />
        <button className="btn" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        <button type="button" className="link" onClick={() => go('forgot')}>Forgot password?</button>
      </form>
      <p className="switch">New here? <button className="link" onClick={() => go('signup')}>Create an account</button></p>
    </>
  );
}

function Forgot({ go }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const match = useMatchStatus(pw, pw2);
  const [token, setToken] = useState('');
  const [step, setStep] = useState('email'); // email -> otp -> newpw
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true); setMsg({});
    try { await fn(); } catch (err) { setMsg({ error: err.message }); }
    setBusy(false);
  };

  const titles = { email: 'Reset your password', otp: 'Check your email', newpw: 'Choose a new password' };

  return (
    <>
      <h1>{titles[step]}</h1>
      {step === 'email' && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/auth/forgot-password', { email }); setStep('otp'); }); }}>
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your registered email" autoComplete="off" required />
          <Alert {...msg} />
          <button className="btn" disabled={busy}>Send code</button>
        </form>
      )}
      {step === 'otp' && (
        <>
          <Alert error={msg.error} />
          <OtpStep email={email} purpose="reset" busy={busy}
            onVerify={(otp) => run(async () => {
              const d = await api('/auth/verify-reset-otp', { email, otp });
              setToken(d.resetToken); setStep('newpw');
            })} />
        </>
      )}
      {step === 'newpw' && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => {
          if (!allRulesPass(pw)) throw new Error('Password does not meet all the rules below.');
          if (pw !== pw2) throw new Error('Passwords do not match.');
          await api('/auth/reset-password', { resetToken: token, newPassword: pw, confirmPassword: pw2 });
          go('login', 'Password updated. Log in with your new password.');
        }); }}>
          <Field label="New password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Create a new password" autoComplete="new-password" required />
          <PasswordRules password={pw} />
          <Field label="Confirm new password" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Re-enter your new password" autoComplete="new-password"
            wrapClass={matchWrapClass(match.status)} onFocus={match.onFocus} onBlur={match.onBlur} required />
          <MatchStatus status={match.status} />
          <Alert {...msg} />
          <button className="btn" disabled={busy}>Save new password</button>
        </form>
      )}
      <p className="switch"><button className="link" onClick={() => go('login')}>Back to log in</button></p>
    </>
  );
}

function Dashboard({ user, onLogout }) {
  return (
    <>
      <h1>Hello, {user.name}</h1>
      <p className="hint">You are logged in as <b>{user.email}</b>. This page is only reachable with a valid token.</p>
      <button className="btn" onClick={onLogout}>Log out</button>
    </>
  );
}

/* ---------- app shell ---------- */

export default function App() {
  const [view, setView] = useState('login');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('session')); } catch { return null; }
  });

  const go = (v, n = '') => { setNotice(n); setView(v); };
  const onLoggedIn = (data) => { sessionStorage.setItem('session', JSON.stringify(data)); setSession(data); };
  const logout = () => { sessionStorage.removeItem('session'); setSession(null); go('login'); };

  return (
    <TubesBackground>
      <main className="shell">
        <aside className="side">
          <h2>Verify, then trust.</h2>
          <p>Every sign-up and password reset is confirmed with a one-time code sent to your inbox.</p>
        </aside>
        <section className="card">
          {session ? <Dashboard user={session.user} onLogout={logout} />
            : view === 'signup' ? <Signup go={go} />
            : view === 'forgot' ? <Forgot go={go} />
            : <Login key={notice} go={go} onLoggedIn={onLoggedIn} notice={notice} />}
        </section>
      </main>
    </TubesBackground>
  );
}