import React, { useState, useEffect } from 'react';
import { videoService } from '../../services/videos';
import { Video } from '../../types/video';
import { Plus, Video as VideoIcon, Trash2, CheckCircle2, AlertCircle, Loader2, ArrowRight, FileText, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ProcessingStep = 'idle' | 'fetching' | 'transcribing' | 'saving' | 'ready' | 'error';

const SAMPLE_CONTENTS = [
  {
    title: "Steve Jobs - Stanford Speech (2005)",
    channel: "Stanford University",
    url: "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
    category: "video" as const,
    transcript: `0:00 I am honored to be with you today at your commencement from one of the finest universities in the world.
0:08 Truth be told, I never graduated from college.
0:13 This is the closest I've ever gotten to a college graduation.
0:18 Today I want to tell you three stories from my life.
0:23 That's it. No big deal. Just three stories.
0:29 The first story is about connecting the dots.
0:35 You can't connect the dots looking forward; you can only connect them looking backwards.
0:42 So you have to trust that the dots will somehow connect in your future.
0:48 You have to trust in something: your gut, destiny, life, karma, whatever.
0:56 This approach has never let me down, and it has made all the difference in my life.`
  },
  {
    title: "How I Learned English Fast",
    channel: "English Fluency Journey",
    url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    category: "video" as const,
    transcript: `0:01 Welcome back to the channel.
0:05 Today I want to talk about how I improved my listening skills.
0:11 When I was younger, I used to travel a lot with my family.
0:17 I watched real interviews and listened to podcasts every single day.
0:24 Consistency was the key to unlocking my fluency.`
  },
  {
    title: "Imagine - John Lennon",
    channel: "John Lennon",
    url: "https://www.youtube.com/watch?v=YkgkThdzX-8",
    category: "music" as const,
    transcript: `0:03 Imagine there's no heaven
0:09 It's easy if you try
0:15 No hell below us
0:21 Above us, only sky
0:27 Imagine all the people
0:33 Livin' for today
0:40 Imagine there's no countries
0:46 It isn't hard to do
0:52 Nothing to kill or die for
0:58 And no religion, too`
  }
];

export const Videos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'video' | 'music'>('video');
  const [manualTranscript, setManualTranscript] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdVideo, setCreatedVideo] = useState<Video | null>(null);
  const navigate = useNavigate();

  const loadVideos = async () => {
    try {
      const data = await videoService.getVideos();
      setVideos(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  const handleProcessVideo = async (e?: React.FormEvent, customPayload?: { url: string; category: 'video' | 'music'; raw_transcript?: string }) => {
    if (e) e.preventDefault();
    const targetUrl = customPayload?.url || url;
    const targetCategory = customPayload?.category || category;
    const targetTranscript = customPayload?.raw_transcript || (showManualInput ? manualTranscript : undefined);

    if (!targetUrl.trim()) return;

    setErrorMessage(null);
    setStep('fetching');

    try {
      const fetchTimer = setTimeout(() => setStep('transcribing'), 1000);
      const savingTimer = setTimeout(() => setStep('saving'), 2000);

      const video = await videoService.createVideo({
        url: targetUrl,
        category: targetCategory,
        raw_transcript: targetTranscript
      });

      clearTimeout(fetchTimer);
      clearTimeout(savingTimer);

      setCreatedVideo(video);
      setStep('ready');
      setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
    } catch (err: any) {
      setStep('error');
      const msg = err.message || 'Falha ao processar vídeo';
      setErrorMessage(msg);
      // If blocked by YouTube or no transcript found, automatically offer manual paste
      if (msg.includes('Render IP ban') || msg.includes('bloqueou') || msg.includes('legendas')) {
        setShowManualInput(true);
      }
    }
  };

  const handleSelectSample = (sample: typeof SAMPLE_CONTENTS[0]) => {
    setUrl(sample.url);
    setCategory(sample.category);
    setManualTranscript(sample.transcript);
    setShowManualInput(true);
    handleProcessVideo(undefined, {
      url: sample.url,
      category: sample.category,
      raw_transcript: sample.transcript
    });
  };

  const resetModal = () => {
    setShowAddModal(false);
    setUrl('');
    setManualTranscript('');
    setShowManualInput(false);
    setStep('idle');
    setErrorMessage(null);
    setCreatedVideo(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Tem certeza que deseja remover este vídeo da sua biblioteca?')) return;
    try {
      await videoService.deleteVideo(id);
      setVideos(videos.filter((v) => v.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao deletar vídeo');
    }
  };

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem' }}>Biblioteca de Mídia</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Vídeos e músicas sincronizados para estudo
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary"
          style={{ padding: '0.6rem 1rem' }}
        >
          <Plus size={18} />
          <span>Adicionar</span>
        </button>
      </div>

      {/* Modal / Card para Adicionar Vídeo */}
      {showAddModal && (
        <div className="card" style={{ marginBottom: '1.75rem', border: '1px solid var(--border-focus)', background: 'var(--gradient-card)' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.4rem' }}>Adicionar Vídeo do YouTube</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
            Cole o link de qualquer vídeo ou música em inglês do YouTube.
          </p>

          {step === 'idle' && (
            <form onSubmit={(e) => handleProcessVideo(e)}>
              <div className="form-group">
                <input
                  type="url"
                  required
                  className="form-input"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="radio"
                    name="category"
                    checked={category === 'video'}
                    onChange={() => setCategory('video')}
                  />
                  <span>🎬 Vídeo (Podcast / Aula)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="radio"
                    name="category"
                    checked={category === 'music'}
                    onChange={() => setCategory('music')}
                  />
                  <span>🎵 Música / Canção</span>
                </label>
              </div>

              {/* Botão para colar transcrição manual */}
              {!showManualInput && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowManualInput(true)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-link)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <FileText size={15} />
                    <span>Prefere colar a transcrição ou letra manualmente?</span>
                  </button>
                </div>
              )}

              {showManualInput && (
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">
                    Transcrição ou Letra (com ou sem timestamps do YouTube):
                  </label>
                  <textarea
                    className="form-input"
                    rows={5}
                    placeholder={`Cole aqui a transcrição copiada do YouTube (ex: 0:12 Hello world) ou letra da música...`}
                    value={manualTranscript}
                    onChange={(e) => setManualTranscript(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                  />
                </div>
              )}

              {/* Quick Samples */}
              <div style={{ padding: '0.85rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.6rem', fontWeight: 600 }}>
                  <Sparkles size={14} color="var(--accent-amber)" />
                  <span>OU ESCOLHA UM CONTEÚDO VERIFICADO PARA TESTAR AGORA:</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {SAMPLE_CONTENTS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'flex-start', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                    >
                      <span>{sample.category === 'music' ? '🎵' : '🎬'}</span>
                      <span style={{ fontWeight: 600 }}>{sample.title}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 'auto' }}>{sample.channel}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={resetModal}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  <span>Processar Vídeo</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}

          {/* Progress Indicator */}
          {(step === 'fetching' || step === 'transcribing' || step === 'saving') && (
            <div style={{ padding: '1rem 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'fetching' ? 'var(--primary)' : 'var(--accent-emerald)' }}>
                  {step === 'fetching' ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'fetching' ? 'Buscando metadados do vídeo...' : '✓ Vídeo identificado no YouTube'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'transcribing' ? 'var(--primary)' : (step === 'saving' ? 'var(--accent-emerald)' : 'var(--text-muted)') }}>
                  {step === 'transcribing' ? <Loader2 size={18} className="animate-spin" /> : (step === 'saving' ? <CheckCircle2 size={18} /> : <div style={{ width: 18 }} />)}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'transcribing' ? 'Obtendo e dividindo transcrição em frases...' : (step === 'saving' ? '✓ Transcrição segmentada' : 'Processamento da transcrição')}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'saving' ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {step === 'saving' ? <Loader2 size={18} className="animate-spin" /> : <div style={{ width: 18 }} />}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'saving' ? 'Preparando lição e sincronização...' : 'Preparando lição'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Ready Step */}
          {step === 'ready' && createdVideo && (
            <div style={{ padding: '0.5rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--accent-emerald)', marginBottom: '1rem' }}>
                <CheckCircle2 size={24} />
                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>Lição pronta para estudo!</span>
              </div>

              <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', background: 'var(--bg-glass)' }}>
                {createdVideo.thumbnail_url && (
                  <img
                    src={createdVideo.thumbnail_url}
                    alt={createdVideo.title}
                    style={{ width: '90px', height: '54px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{createdVideo.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{createdVideo.channel}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button onClick={resetModal} className="btn btn-secondary">
                  Fechar
                </button>
                <button
                  onClick={() => navigate(`/videos/${createdVideo.id}`)}
                  className="btn btn-primary"
                >
                  <span>Começar a Estudar</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Error Step with direct Paste Fallback */}
          {step === 'error' && (
            <div style={{ padding: '0.5rem 0' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '1rem',
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-rose)',
                fontSize: '0.9rem',
                marginBottom: '1.25rem'
              }}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Aviso de Transcrição</div>
                  <div>{errorMessage}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '0.5rem' }}>
                    Como os servidores em nuvem (Render/AWS) sofrem bloqueio de IP do YouTube, você pode colar a transcrição diretamente do vídeo abaixo:
                  </div>
                </div>
              </div>

              {/* Paste fallback box */}
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" style={{ color: '#fff', fontWeight: 600 }}>
                  📋 Cole a Transcrição do Vídeo aqui:
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>
                  No YouTube, clique em "... Mais" abaixo do vídeo &gt; "Mostrar transcrição", copie e cole aqui:
                </p>
                <textarea
                  className="form-input"
                  rows={6}
                  placeholder={`0:00 Hello everyone\n0:05 Today we learn English...`}
                  value={manualTranscript}
                  onChange={(e) => setManualTranscript(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button onClick={resetModal} className="btn btn-secondary">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleProcessVideo(undefined, { url, category, raw_transcript: manualTranscript })}
                  className="btn btn-primary"
                  disabled={!manualTranscript.trim()}
                >
                  <span>Processar Transcrição Colada</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Carregando biblioteca...</p>
      ) : videos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', background: 'var(--bg-glass)', borderRadius: '50%', marginBottom: '1rem' }}>
            <VideoIcon size={36} color="var(--text-muted)" />
          </div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.4rem' }}>Nenhum conteúdo adicionado</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto 1.5rem auto' }}>
            Cole o link de um vídeo do YouTube ou música para obter a transcrição sincronizada e começar a estudar.
          </p>
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            <span>Adicionar Agora</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {videos.map((video) => (
            <div
              key={video.id}
              className="card card-interactive"
              onClick={() => navigate(`/videos/${video.id}`)}
            >
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <img
                  src={video.thumbnail_url || 'https://via.placeholder.com/120x68'}
                  alt={video.title}
                  style={{ width: '100px', height: '62px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.98rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {video.title}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {video.channel || 'YouTube'} • {video.category === 'music' ? '🎵 Música' : '🎬 Vídeo'}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(video.id, e)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem' }}
                  title="Excluir vídeo"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
