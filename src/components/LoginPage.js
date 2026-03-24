// src/components/LoginPage.js
import { useState, useEffect } from 'react';
import { signIn } from '../utils/storageAdapter';
import './LoginPage.css';

const FA_LOGO = process.env.PUBLIC_URL + '/FA_Original_transparent-01.svg';

function LoginPage() {
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                     = useState('');
  const [loading, setLoading]                 = useState(false);
  const [mode, setMode]                       = useState('login'); // 'login' | 'set-password'

  useEffect(() => {
    // Läs från sessionStorage — satt av inline script i index.html
    const authType = sessionStorage.getItem('supabase_auth_type');
    if (authType === 'invite' || authType === 'recovery') {
      setMode('set-password');
    }
  }, []);

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

    setLoading(true);
    try {
      const { supabase } = await import('../utils/supabaseClient');

      // Sätt lösenordet — Supabase JS har sessionen från invite-token
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      // Hämta metadata som sattes vid invite
      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = user?.user_metadata?.organization_id;
      const role           = user?.user_metadata?.role;

      // Skapa org_members-rad nu när användaren är bekräftad
      if (organizationId && role) {
        const { error: memberError } = await supabase
          .from('org_members')
          .upsert({
            organization_id: organizationId,
            user_id:         user.id,
            role,
          }, { onConflict: 'organization_id,user_id' });

        if (memberError) throw memberError;
      }

      // Rensa sessionStorage och hash, ladda om utan invite-flöde
      sessionStorage.removeItem('supabase_auth_type');
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
