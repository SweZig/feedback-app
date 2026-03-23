// src/components/LoginPage.js
import { useState } from 'react';
import { signIn } from '../utils/storageAdapter';
import './LoginPage.css';

const FA_LOGO = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      // onAuthStateChange i App.js hanterar resten
    } catch (err) {
      setError(getFriendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }

  function getFriendlyError(msg) {
    if (msg?.includes('Invalid login credentials')) return 'Fel e-postadress eller lösenord.';
    if (msg?.includes('Email not confirmed'))       return 'E-postadressen är inte bekräftad.';
    if (msg?.includes('Too many requests'))         return 'För många försök. Vänta en stund och försök igen.';
    return 'Inloggningen misslyckades. Försök igen.';
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <img src={FA_LOGO} alt="Feedback App" className="login-logo" />
        <h1 className="login-title">Logga in</h1>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label">
            E-postadress
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="din@epost.se"
              autoComplete="email"
              required
              disabled={loading}
            />
          </label>

          <label className="login-label">
            Lösenord
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Loggar in...' : 'Logga in'}
          </button>
        </form>

        <p className="login-footer">
          Glömt lösenordet? Kontakta din administratör.
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
