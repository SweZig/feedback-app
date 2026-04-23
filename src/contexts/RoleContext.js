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
    if (!organizationId) {
      setLoading(false);
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Ladda roll och permissions parallellt för att halvera latensen.
      // Viktigt: setStates efter denna await körs i samma mikrotask och
      // batchas därför av React 18 till EN re-render. Det eliminerar
      // race conditionen där realRole hann sättas innan permissions,
      // vilket gjorde att en analytiker kort såg Enkät (default=true i
      // DEFAULT_PERMISSIONS) innan de riktiga permissions laddats.
      const [memberRes, perms] = await Promise.all([
        supabase
          .from('org_members')
          .select('role')
          .eq('organization_id', organizationId)
          .eq('user_id', user.id)
          .single(),
        getPermissions(organizationId),
      ]);

      setRealRole(memberRes.data?.role || null);
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
