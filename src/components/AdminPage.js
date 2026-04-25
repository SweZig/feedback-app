// src/components/AdminPage.js
import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  getOrgUsers, inviteUser, updateUserRole,
  removeUserFromOrg, getAllOrganizations, getMyRole,
  ROLE_LABELS, ROLE_ORDER,
} from '../utils/userManagement';
import { getCurrentUser } from '../utils/storageAdapter';
import {
  PERMISSION_GROUPS, DEFAULT_PERMISSIONS,
  getPermissions, savePermissions,
} from '../utils/permissions';
import { useRole } from '../contexts/RoleContext';
import './AdminPage.css';

const ROLES = ['owner', 'admin', 'manager', 'analytiker'];

function RoleBadge({ role }) {
  return <span className={`role-badge role-badge--${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="admin-overlay" onClick={onCancel}>
      <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="admin-dialog-msg">{message}</p>
        <div className="admin-dialog-btns">
          <button className="admin-btn admin-btn--danger" onClick={onConfirm}>Ja, ta bort</button>
          <button className="admin-btn admin-btn--ghost" onClick={onCancel}>Avbryt</button>
        </div>
      </div>
    </div>
  );
}

function InviteForm({ organizationId, myRole, onInvited }) {
  const [email, setEmail]     = useState('');
  const [role, setRole]       = useState('manager');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const availableRoles = myRole === 'owner'
    ? ['admin', 'manager', 'analytiker']
    : ['manager', 'analytiker'];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(''); setSuccess(''); setLoading(true);
    try {
      await inviteUser(email.trim(), role, organizationId);
      setSuccess(`Inbjudan skickad till ${email.trim()}`);
      setEmail('');
      onInvited?.();
    } catch (err) {
      setError(err.message || 'Inbjudan misslyckades');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-invite-form">
      <h3 className="admin-section-title">Bjud in användare</h3>
      <form className="admin-form-row" onSubmit={handleSubmit}>
        <input className="admin-input" type="email" placeholder="e-postadress"
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} required />
        <select className="admin-select" value={role}
          onChange={(e) => setRole(e.target.value)} disabled={loading}>
          {availableRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        <button className="admin-btn admin-btn--primary" type="submit" disabled={loading}>
          {loading ? 'Skickar...' : 'Skicka inbjudan'}
        </button>
      </form>
      {error   && <p className="admin-msg admin-msg--error">✗ {error}</p>}
      {success && <p className="admin-msg admin-msg--success">✓ {success}</p>}
    </div>
  );
}

function UserList({ users, currentUserId, myRole, onRoleChange, onRemove }) {
  if (users.length === 0) return <p className="admin-empty">Inga användare hittades.</p>;
  return (
    <div className="admin-user-list">
      {users.map((u) => {
        const isMe = u.userId === currentUserId;
        const canEdit = !isMe && (myRole === 'owner' || (myRole === 'admin' && u.role !== 'owner'));
        return (
          <div key={u.memberId} className={`admin-user-card ${isMe ? 'admin-user-card--me' : ''}`}>
            <div className="admin-user-info">
              <span className="admin-user-email">{u.email}</span>
              {u.displayName && <span className="admin-user-name">{u.displayName}</span>}
              {isMe && <span className="admin-user-you">Du</span>}
              {u.lastLogin && (
                <span className="admin-user-login">
                  Senast inloggad: {new Date(u.lastLogin).toLocaleDateString('sv-SE')}
                </span>
              )}
            </div>
            <div className="admin-user-actions">
              {canEdit ? (
                <select className="admin-select admin-select--sm" value={u.role}
                  onChange={(e) => onRoleChange(u.memberId, e.target.value)}>
                  {ROLE_ORDER.filter((r) => myRole === 'owner' || r !== 'owner').map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              ) : (
                <RoleBadge role={u.role} />
              )}
              {canEdit && (
                <button className="admin-btn admin-btn--icon" title="Ta bort"
                  onClick={() => onRemove(u)}>×</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PermissionsMatrix({ organizationId }) {
  const { reloadRole } = useRole();
  const [perms, setPerms]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    getPermissions(organizationId)
      .then(setPerms)
      .catch(() => setPerms({ ...DEFAULT_PERMISSIONS }));
  }, [organizationId]);

  function toggle(feature, role) {
    if (role === 'owner') return;
    setPerms((prev) => ({
      ...prev,
      [feature]: { ...prev[feature], [role]: !prev[feature][role] },
    }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await savePermissions(organizationId, perms);
      // Ladda om roll/permissions i RoleContext så att Navigation och
      // Rollsimulering reflekterar ändringen direkt (ingen refresh krävs).
      await reloadRole();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError('Kunde inte spara: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!perms) return <p className="admin-empty">Laddar behörigheter...</p>;

  return (
    <div className="admin-perms">
      <div className="admin-perms-header">
        <p className="admin-perms-desc">
          Kryssa i vilka roller som ska ha tillgång till varje funktion.
          Owner har alltid full tillgång och kan inte ändras.
        </p>
        <div className="admin-perms-actions">
          <button className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => { setPerms({ ...DEFAULT_PERMISSIONS }); setSaved(false); }}>
            Återställ till standard
          </button>
          <button className="admin-btn admin-btn--primary admin-btn--sm"
            onClick={handleSave} disabled={saving}>
            {saving ? 'Sparar...' : 'Spara behörigheter'}
          </button>
        </div>
      </div>

      {saved && <p className="admin-msg admin-msg--success">✓ Behörigheter sparade</p>}
      {error && <p className="admin-msg admin-msg--error">✗ {error}</p>}

      <div className="admin-perms-table-wrap">
        <table className="admin-perms-table">
          <thead>
            <tr>
              <th className="admin-perms-th-feature">Funktion</th>
              {ROLES.map((r) => (
                <th key={r} className="admin-perms-th-role"><RoleBadge role={r} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => (
              <Fragment key={group.group}>
                <tr className="admin-perms-group-row">
                  <td colSpan={ROLES.length + 1} className="admin-perms-group-label">
                    {group.group}
                  </td>
                </tr>
                {group.features.map((feature) => (
                  <tr key={feature.key} className="admin-perms-row">
                    <td className="admin-perms-feature">{feature.label}</td>
                    {ROLES.map((role) => (
                      <td key={role} className="admin-perms-cell">
                        <input
                          type="checkbox"
                          className="admin-perms-checkbox"
                          checked={role === 'owner' ? true : (perms[feature.key]?.[role] ?? false)}
                          onChange={() => toggle(feature.key, role)}
                          disabled={role === 'owner'}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleSimulator() {
  const { realRole, simulatedRole, startSimulation, stopSimulation } = useRole();
  const simulatableRoles = ROLE_ORDER.filter((r) => r !== 'owner' && r !== realRole);

  return (
    <div className="admin-simulator">
      <h3 className="admin-section-title">Rollsimulering</h3>
      <p className="admin-perms-desc">
        Simulera hur appen ser ut för olika användarroller. Bara du ser simuleringen —
        din faktiska roll påverkas inte.
      </p>

      {simulatedRole ? (
        <div className="admin-sim-active">
          <div className="admin-sim-banner">
            <span>🎭 Simulerar <strong>{ROLE_LABELS[simulatedRole]}</strong></span>
            <button className="admin-btn admin-btn--danger admin-btn--sm" onClick={stopSimulation}>
              Avsluta simulering
            </button>
          </div>
          <p className="admin-perms-desc" style={{ marginTop: '0.5rem' }}>
            Navigera runt i appen för att se vad denna roll kan komma åt.
            Kom tillbaka hit för att avsluta.
          </p>
        </div>
      ) : (
        <div className="admin-sim-buttons">
          {simulatableRoles.map((role) => (
            <button key={role} className="admin-sim-btn" onClick={() => startSimulation(role)}>
              <span>🎭 Simulera {ROLE_LABELS[role]}</span>
              <RoleBadge role={role} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminPage() {
  const [tab, setTab]                     = useState('users');
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [users, setUsers]                 = useState([]);
  const [myRole, setMyRole]               = useState(null);
  const [currentUser, setCurrentUser]     = useState(null);
  const [loading, setLoading]             = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [error, setError]                 = useState('');

  const TABS = [
    { key: 'users',       label: 'Användare' },
    { key: 'permissions', label: 'Behörigheter' },
    { key: 'simulation',  label: 'Rollsimulering' },
  ];

  useEffect(() => {
    async function init() {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
        const orgs = await getAllOrganizations();
        setOrganizations(orgs);
        if (orgs.length > 0) setSelectedOrgId(orgs[0].id);
      } catch (err) {
        setError('Kunde inte ladda organisationer: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const loadUsers = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    try {
      const [fetchedUsers, role] = await Promise.all([
        getOrgUsers(selectedOrgId),
        getMyRole(selectedOrgId),
      ]);
      setUsers(fetchedUsers);
      setMyRole(role);
    } catch (err) {
      setError('Kunde inte ladda användare: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function handleRoleChange(memberId, newRole) {
    try {
      await updateUserRole(memberId, newRole);
      await loadUsers();
    } catch (err) {
      setError('Kunde inte ändra roll: ' + err.message);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    try {
      await removeUserFromOrg(confirmRemove.memberId);
      setConfirmRemove(null);
      await loadUsers();
    } catch (err) {
      setError('Kunde inte ta bort användare: ' + err.message);
    }
  }

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
  const canManage = myRole === 'owner' || myRole === 'admin';

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1 className="admin-title">Användarhantering</h1>
        {myRole && <RoleBadge role={myRole} />}
      </div>

      {error && (
        <div className="admin-error-banner" onClick={() => setError('')}>
          ⚠ {error} <span className="admin-error-close">×</span>
        </div>
      )}

      {organizations.length > 1 && (
        <div className="admin-org-selector">
          <label className="admin-label">Organisation</label>
          <select className="admin-select" value={selectedOrgId || ''}
            onChange={(e) => setSelectedOrgId(e.target.value)}>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key}
            className={`admin-tab ${tab === t.key ? 'admin-tab--active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          {canManage && selectedOrgId && (
            <InviteForm organizationId={selectedOrgId} myRole={myRole} onInvited={loadUsers} />
          )}
          <div className="admin-users-section">
            <h3 className="admin-section-title">
              Användare{selectedOrg ? ` — ${selectedOrg.name}` : ''}
              {!loading && <span className="admin-user-count">{users.length} st</span>}
            </h3>
            {loading ? <p className="admin-empty">Laddar...</p> : (
              <UserList
                users={users}
                currentUserId={currentUser?.id}
                myRole={myRole}
                onRoleChange={handleRoleChange}
                onRemove={(u) => setConfirmRemove(u)}
              />
            )}
          </div>
        </>
      )}

      {tab === 'permissions' && selectedOrgId && (
        <PermissionsMatrix organizationId={selectedOrgId} />
      )}

      {tab === 'simulation' && <RoleSimulator />}

      {confirmRemove && (
        <ConfirmDialog
          message={`Ta bort ${confirmRemove.email} från organisationen?`}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

export default AdminPage;
