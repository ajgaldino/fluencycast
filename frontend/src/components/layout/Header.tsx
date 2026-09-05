import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LogOut, Flame, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const streak = user?.profile?.current_streak ?? 1;

  return (
    <header className="app-header">
      <Link to="/dashboard" className="brand-logo">
        <Sparkles size={22} color="#6366f1" />
        <div>Fluency<span>Cast</span></div>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        {user && (
          <>
            <div className="badge badge-amber" title="Ofensiva de estudos">
              <Flame size={14} />
              <span>{streak}d</span>
            </div>

            <button
              onClick={logout}
              className="btn btn-secondary"
              style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)' }}
              title="Sair da conta"
            >
              <LogOut size={15} />
              <span style={{ display: 'none' }} className="mobile-hide">Sair</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
