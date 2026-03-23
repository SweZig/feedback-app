// src/components/AdminPage.js
import { useState, useEffect, useCallback } from 'react';
import {
  getOrgUsers, inviteUser, updateUserRole,
  removeUserFromOrg, getAllOrganizations, getMyRole,
  ROLE_LABELS, ROLE_ORDER,
} from '../utils/userManagement';
import { getCurrentUser } from '../utils/storageAdapter';
import './AdminPage.css';

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
  const [email, setEmail]   = useState('');
  const [role, setRole]     = useState('manager');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState('');

  // Owner kan bjuda in alla roller, admin kan bara bjuda in manager/analytiker
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
        <input
          className="admin-input"
          type="email"
          placeholder="e-postadress"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          required
        />
        <select
          className="admin-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={loading}
        >
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
  if (users.length === 0) {
    return <p className="admin-empty">Inga användare hittades.</p>;
  }

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
                <select
                  className="admin-select admin-select--sm"
                  value={u.role}
                  onChange={(e) => onRoleChange(u.memberId, e.target.value)}
                >
                  {ROLE_ORDER.filter((r) => myRole === 'owner' || r !== 'owner').map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              ) : (
                <RoleBadge role={u.role} />
              )}
              {canEdit && (
                <button
                  className="admin-btn admin-btn--icon"
                  title="Ta bort från organisation"
                  onClick={() => onRemove(u)}
                >×</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminPage() {
  const [organizations, setOrganizations]   = useState([]);
  const [selectedOrgId, setSelectedOrgId]   = useState(null);
  const [users, setUsers]                   = useState([]);
  const [myRole, setMyRole]                 = useState(null);
  const [currentUser, setCurrentUser]       = useState(null);
  const [loading, setLoading]               = useState(true);
  const [confirmRemove, setConfirmRemove]   = useState(null);
  const [error, setError]                   = useState('');

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

      {/* Organisationsväljare */}
      {organizations.length > 1 && (
        <div className="admin-org-selector">
          <label className="admin-label">Organisation</label>
          <select
            className="admin-select"
            value={selectedOrgId || ''}
            onChange={(e) => setSelectedOrgId(e.target.value)}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Inbjudningsformulär */}
      {canManage && selectedOrgId && (
        <InviteForm
          organizationId={selectedOrgId}
          myRole={myRole}
          onInvited={loadUsers}
        />
      )}

      {/* Användarlista */}
      <div className="admin-users-section">
        <h3 className="admin-section-title">
          Användare{selectedOrg ? ` — ${selectedOrg.name}` : ''}
          {!loading && <span className="admin-user-count">{users.length} st</span>}
        </h3>

        {loading ? (
          <p className="admin-empty">Laddar...</p>
        ) : (
          <UserList
            users={users}
            currentUserId={currentUser?.id}
            myRole={myRole}
            onRoleChange={handleRoleChange}
            onRemove={(u) => setConfirmRemove(u)}
          />
        )}
      </div>

      {/* Bekräftelsedialog */}
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
