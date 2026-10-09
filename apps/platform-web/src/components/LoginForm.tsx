'use client';

import { useState } from 'react';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

export interface LoginFormViewProps {
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: () => void;
}

/** Vista pura (testeable sin navegador). Etiquetas visibles, autocompletado y error anunciado. */
export function LoginFormView(p: LoginFormViewProps) {
  return (
    <form
      className="card"
      aria-labelledby="login-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <h1 id="login-title">Ingresar a TRUST</h1>
      <label htmlFor="login-email">Email</label>
      <input id="login-email" name="email" type="email" autoComplete="username" required value={p.email} onChange={(e) => p.onEmail(e.target.value)} />
      <label htmlFor="login-password">Contraseña</label>
      <input id="login-password" name="password" type="password" autoComplete="current-password" required value={p.password} onChange={(e) => p.onPassword(e.target.value)} />
      <ErrorMessage message={p.error} />
      <button type="submit" disabled={p.submitting} aria-busy={p.submitting}>
        {p.submitting ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}

export function LoginForm() {
  const { client, setMe } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const me = await client.login(email.trim(), password);
      setPassword('');
      setMe(me); // la guarda de SessionGate redirige a `next`
    } catch (e) {
      setError(describeError(e));
      setSubmitting(false);
    }
  };

  return <LoginFormView email={email} password={password} submitting={submitting} error={error} onEmail={setEmail} onPassword={setPassword} onSubmit={() => void onSubmit()} />;
}
