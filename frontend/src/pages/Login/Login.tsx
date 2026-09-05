import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Sparkles, ArrowRight, AlertCircle } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Falha ao autenticar.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <div style={{ display: 'inline-flex', padding: '0.75rem', background: 'var(--primary-light)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
            <Sparkles size={32} color="#818cf8" />
          </div>
          <h1>Bem-vindo de volta</h1>
          <p>Aprenda inglês com conteúdos reais do YouTube</p>
        </div>

        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.75rem 1rem',
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent-rose)',
            fontSize: '0.88rem',
            marginBottom: '1.25rem'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              required
              className="form-input"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              required
              className="form-input"
              placeholder="Sua senha secreta"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary btn-block mt-4"
          >
            <span>{submitting ? 'Entrando...' : 'Entrar na Plataforma'}</span>
            <ArrowRight size={18} />
          </button>
        </form>

        <p className="text-center mt-4" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Não tem uma conta?{' '}
          <Link to="/register" style={{ fontWeight: 600 }}>Cadastre-se grátis</Link>
        </p>
      </div>
    </div>
  );
};
