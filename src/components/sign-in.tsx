'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
export default function SignIn({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (!seconds) return;
    const timer = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  async function send() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim().toLowerCase(),
        type: 'sign-in',
      });
      if (result.error)
        throw new Error(
          result.error.code === 'ACCESS_DENIED'
            ? 'Cette adresse n’a pas accès au restaurant.'
            : result.error.code?.includes('RATE')
              ? 'Veuillez patienter avant de demander un nouveau code.'
              : 'Impossible d’envoyer le code. Réessayez dans un instant.',
        );
      setPhase('code');
      setSeconds(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi du code indisponible.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function verify() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.emailOtp({
        email: email.trim().toLowerCase(),
        otp: code,
      });
      if (result.error)
        throw new Error(
          'Code incorrect ou expiré. Vérifiez le code reçu ou demandez-en un nouveau.',
        );
      onAuthenticated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img className="auth-logo" src="/logo-burger-house.jpg" alt="Burger House" />
        <span className="auth-location">Saint-Rambert-d’Albon</span>
        <h1>{phase === 'email' ? 'Connexion au restaurant' : 'Vérifiez votre boîte mail'}</h1>
        <p className="auth-description">
          {phase === 'email' ? (
            'Connectez-vous pour retrouver vos recettes, vos dépenses et les pointages de votre équipe.'
          ) : (
            <>
              Saisissez le code envoyé à <strong>{email}</strong>.
            </>
          )}
        </p>
        <form
          className="form auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void (phase === 'email' ? send() : verify());
          }}
        >
          {phase === 'email' ? (
            <label>
              Adresse e-mail
              <input
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Votre adresse autorisée"
                required
                maxLength={254}
              />
            </label>
          ) : (
            <label>
              Code de connexion
              <input
                className="auth-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                minLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                aria-label="Code de connexion à six chiffres"
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-primary full" disabled={busy}>
            {busy
              ? 'Connexion…'
              : phase === 'email'
                ? 'Recevoir mon code'
                : 'Ouvrir mon restaurant'}
            {phase === 'email' ? <Mail size={18} /> : <ArrowRight size={18} />}
          </button>
          {phase === 'code' && (
            <div className="auth-resend">
              <button
                type="button"
                className="text-button"
                disabled={busy || seconds > 0}
                onClick={() => void send()}
              >
                {seconds > 0 ? `Renvoyer dans ${seconds} s` : 'Renvoyer le code'}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setPhase('email');
                  setCode('');
                  setError('');
                }}
              >
                <ArrowLeft size={15} />
                Autre adresse
              </button>
            </div>
          )}
        </form>
        <div className="auth-privacy">
          <ShieldCheck size={17} />
          <span>
            Accès privé · code à usage unique
            <br />
            Vos données restent sauvegardées après la fermeture de l’app.
          </span>
        </div>
      </section>
    </main>
  );
}
