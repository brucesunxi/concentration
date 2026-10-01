import { useEffect, useRef, useState } from 'react';
import { AccountSecurityClient } from './account-security-client.ts';
import type { SecurityState } from './account-security-client.ts';
import type { AccountAction } from '../contracts/account-security.ts';
type Request = ConstructorParameters<typeof AccountSecurityClient>[1];
export function useAccountSecurity(familyId: string, request: Request) {
  const current = useRef<AccountSecurityClient | null>(null);
  const [state, setState] = useState<SecurityState>({ data: null, busy: true, error: '', outcome: null });
  useEffect(() => {
    const client = new AccountSecurityClient(familyId, request, setState); current.current = client; setState(client.state); void client.load();
    return () => { client.dispose(); if (current.current === client) current.current = null; };
  }, [familyId, request]);
  return { state, reload: () => current.current?.load(), submit: (action: AccountAction, input: { currentPassword: string; newPassword?: string; familyName?: string; acknowledged: true }) => current.current?.submit(action, input) };
}
