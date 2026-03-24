// src/components/LoginPage.js
import { useState, useEffect } from 'react';
import { signIn } from '../utils/storageAdapter';
import './LoginPage.css';

const FA_LOGO = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

// Dekoda JWT-payload utan extern lib
function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

function LoginPage() {
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [mode, setMode]                       = useState('login'); // 'login' | 'set-password'
  const [inviteData, setInviteData]           = useState(null); // { userId, organizationId, role }

  useEffect(() => {
    const authType = sessionStorage.getItem('supabase_auth_type');
    if (authType !== 'invite' && authType !== 'recovery') return;

    setMode('set-password');

    // Dekoda access_token för att få userId och metadata
    const accessToken = sessionStorage.getItem('supabase_access_token');
    if (accessToken) {
      const payload = parseJwt(accessToken);
      if (payload) {
        setInviteData({
          userId:         payload.sub,
          organizationId: payload.user_metadata?.organization_id,
          role:           payload.user_metadata?.role,
        });
      }
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(getFriendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Lösenordet måste vara minst 8 tecken.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Lösenorden matchar inte.');
      return;
    }
    if (!inviteData?.userId || !inviteData?.organizationId || !inviteData?.role) {
      setError('Sessionen har gått ut. Kontakta administratören för en ny inbjudan.');
      return;
    }

    setLoading(true);
    try {
      // Allt sker server-side — inga sessions-problem på klienten
      const response = await fetch('/api/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:         inviteData.userId,
          password:       newPassword,
          organizationId: inviteData.organizationId,
          role:           inviteData.role,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Serverfel');

      // Rensa sessionStorage och ladda om
      sessionStorage.removeItem('supabase_auth_type');
      sessionStorage.removeItem('supabase_access_token');
      sessionStorage.removeItem('supabase_refresh_token');
      window.history.replaceState(null, '', window.location.pathname);
      window.location.reload();

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
    if (msg?.includes('Auth session missing'))      return 'Sessionen har gått ut. Kontakta administratören för en ny inbjudan.';
    return 'Något gick fel. Försök igen.';
  }

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <img src={FA_LOGO} alt="Feedback App" className="login-logo" />
        <h1 className="login-title">
          {mode === 'set-password' ? 'Välj lösenord' : 'Logga in'}
        </h1>

        {mode === 'set-password' ? (
          <form className="login-form" onSubmit={handleSetPassword}>
            <p style={{ fontSize: '0.9rem', color: '#7a9aaa', marginBottom: '1rem' }}>
              Du har blivit inbjuden till Feedback App. Välj ett lösenord för att aktivera ditt konto.
            </p>

            <label className="login-label">
              Nytt lösenord
              <input
                className="login-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minst 8 tecken"
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </label>

            <label className="login-label">
              Bekräfta lösenord
              <input
                className="login-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Upprepa lösenordet"
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </label>

            {error && <p className="login-error">{error}</p>}

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? 'Sparar...' : 'Aktivera konto'}
            </button>
          </form>
        ) : (
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
        )}

        <p className="login-footer">
          {mode === 'set-password'
            ? 'Problem med inbjudan? Kontakta din administratör.'
            : 'Glömt lösenordet? Kontakta din administratör.'}
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
