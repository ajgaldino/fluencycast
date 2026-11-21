import React, { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Video, Bookmark, BrainCircuit, BarChart2, Gamepad2 } from 'lucide-react';
import { gamesService } from '../../services/games';
import { usePolling } from '../../hooks/usePolling';

export const BottomNav: React.FC = () => {
  const [badge, setBadge] = useState(0);

  const checkPending = useCallback(async () => {
    try {
      const res = await gamesService.getPendingCount();
      setBadge(res.count);
    } catch {
      // ignore transient network errors on background nav polling
    }
  }, []);

  useEffect(() => {
    void checkPending();
  }, [checkPending]);
  usePolling(checkPending, 12000);
  return (
    <nav className="bottom-nav">
      <NavLink
        to="/dashboard"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <Home size={20} />
        <span>Início</span>
      </NavLink>

      <NavLink
        to="/videos"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <Video size={20} />
        <span>Vídeos</span>
      </NavLink>

      <NavLink
        to="/phrases"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <Bookmark size={20} />
        <span>Frases</span>
      </NavLink>

      <NavLink
        to="/reviews"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <BrainCircuit size={20} />
        <span>Revisar</span>
      </NavLink>

      <NavLink
        to="/progress"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <BarChart2 size={20} />
        <span>Progresso</span>
      </NavLink>

      <NavLink
        to="/games"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <div className="nav-icon-wrap">
          <Gamepad2 size={20} />
          {badge > 0 && <span className="nav-badge">{badge > 9 ? '9+' : badge}</span>}
        </div>
        <span>Games</span>
      </NavLink>
    </nav>
  );
};
