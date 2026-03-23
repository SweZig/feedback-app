// src/contexts/RoleContext.js
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabaseClient';
import { getPermissions, DEFAULT_PERMISSIONS, can as canFn } from '../utils/permissions';

const RoleContext = createContext(null);

export function RoleProvider({ children, organizationId }) {
  const [realRole, setRealRole]           = useState(null);
  const [simulatedRole, setSimulatedRole] = useState(null);
  const [permissions, setPermissions]     = useState(DEFAULT_PERMISSIONS);
  const [loading, setLoading]             = useState(true);

  const activeRole = simulatedRole || realRole;

  const loadRole = useCallback(async () => {
    if (!organizationId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('org_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

      setRealRole(data?.role || null);

      const perms = await getPermissions(organizationId);
      setPermissions(perms);
    } catch (err) {
      console.error('[RoleContext]', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { loadRole(); }, [loadRole]);

  function startSimulation(role) {
    setSimulatedRole(role);
  }

  function stopSimulation() {
    setSimulatedRole(null);
  }

  function can(feature) {
    return canFn(permissions, activeRole, feature);
  }

  return (
    <RoleContext.Provider value={{
      realRole,
      simulatedRole,
      activeRole,
      permissions,
      loading,
      can,
      startSimulation,
      stopSimulation,
      reloadRole: loadRole,
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole måste användas inom RoleProvider');
  return ctx;
}
