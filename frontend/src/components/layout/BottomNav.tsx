import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Video, Bookmark, BrainCircuit, BarChart2 } from 'lucide-react';

export const BottomNav: React.FC = () => {
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
    </nav>
  );
};
