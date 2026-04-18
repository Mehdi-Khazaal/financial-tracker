import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import { plaidCreateLinkToken, plaidExchangeToken } from '../utils/api';
import { useToast } from '../context/ToastContext';

const OAuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('plaid_link_token');
    if (stored) {
      setLinkToken(stored);
    } else {
      plaidCreateLinkToken()
        .then(r => setLinkToken(r.data.link_token))
        .catch(() => { toast.error('Failed to resume bank connection'); navigate('/settings'); });
    }
  }, [navigate, toast]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: window.location.href,
    onSuccess: async (public_token, metadata) => {
      const institution_name = (metadata as any)?.institution?.name as string | undefined;
      try {
        await plaidExchangeToken(public_token, institution_name);
        toast.success(`${institution_name || 'Bank'} connected! Syncing transactions...`);
        sessionStorage.removeItem('plaid_link_token');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Failed to connect bank');
      }
      navigate('/settings');
    },
    onExit: () => {
      sessionStorage.removeItem('plaid_link_token');
      navigate('/settings');
    },
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return (
    <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#070810' }}>
      <div className="text-center">
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow mx-auto mb-4"
          style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
        <p className="text-sm text-muted">Completing bank connection...</p>
      </div>
    </div>
  );
};

export default OAuthCallback;
