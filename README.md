# 🎬 FluencyCast - English by Immersion

> Plataforma de aprendizado de inglês baseada em vídeos reais do YouTube e músicas, com transcrição sincronizada, biblioteca contextual de frases e repetição espaçada (SRS).

---

## 🚀 Tecnologias

### **Backend**
- **Python 3.11+ / FastAPI**: Alta performance e documentação OpenAPI nativa.
- **SQLAlchemy 2.0**: ORM moderno e tipado com integridade relacional.
- **Alembic**: Gerenciamento e histórico de migrações de banco de dados.
- **PostgreSQL 16**: Banco relacional robusto.
- **JWT + Bcrypt**: Autenticação stateless segura com tokens Bearer.
- **Pytest**: Suíte automatizada de testes unitários e de integração.

### **Frontend**
- **React 18 + TypeScript**: Tipagem estática e componentes modulares.
- **Vite**: Ferramenta de build ultrarrápida.
- **React Router v6**: Roteamento SPA com rotas protegidas.
- **Pure CSS / CSS Modules**: Design system moderno com paleta escura (HSL), glassmorphism, mobile-first e animações fluidas (sem Tailwind).
- **PWA Ready**: Preparado para instalação no celular com `manifest.json`.

### **Infraestrutura**
- **Docker & Docker Compose**: Orquestração completa de banco, backend e frontend.

---

## 📁 Estrutura de Pastas

```text
ProjetoInglesMusica/
├── docker-compose.yml       # Orquestração do PostgreSQL, Backend e Frontend
├── .env.example             # Modelo de variáveis de ambiente
├── .env                     # Variáveis locais
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/             # Migrações do banco de dados
│   │   ├── env.py
│   │   └── versions/        # 001_initial.py
│   ├── app/
│   │   ├── main.py          # Entrypoint FastAPI com CORS e lifespan
│   │   ├── core/            # Configurações, segurança (Bcrypt/JWT) e banco
│   │   ├── models/          # Modelos SQLAlchemy (User, Video, Segment, Phrase, Review)
│   │   ├── schemas/         # Pydantic schemas v2
│   │   └── api/v1/          # Endpoints (/auth, /videos, /phrases, /reviews, /progress)
│   └── tests/               # Testes com Pytest e SQLite in-memory
│
└── frontend/
    ├── Dockerfile
    ├── index.html           # Tipografia Outfit/Inter, mobile viewport e PWA tags
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/
    │   └── manifest.json    # Metadados de instalação PWA
    └── src/
        ├── main.tsx
        ├── App.tsx          # Roteador principal
        ├── index.css        # Design system mobile-first em CSS puro
        ├── contexts/        # AuthContext com persistência de token
        ├── services/        # Clientes de API (/auth, /videos, /phrases, /reviews)
        ├── types/           # Interfaces TypeScript completas
        ├── components/      # Header, BottomNav, ProtectedRoute
        └── pages/           # Login, Register, Dashboard, Videos, Phrases, Reviews, Progress
```

---

## 🛠️ Como Executar o Projeto

### Opção 1: Via Docker Compose (Recomendado)

Certifique-se de que o Docker Desktop esteja em execução e execute na raiz:

```bash
docker compose up --build
```

Os serviços estarão disponíveis em:
- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **Swagger Docs (OpenAPI)**: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
- **PostgreSQL**: `localhost:5432`

---

### Opção 2: Execução Local para Desenvolvimento

#### 1. Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate      # No Windows (ou `source venv/bin/activate` no Linux/Mac)
pip install -r requirements.txt

# Executar os testes automatizados
pytest tests -v

# Iniciar o servidor FastAPI com recarregamento contínuo
uvicorn app.main:app --reload --port 8000
```

#### 2. Migrações do Banco de Dados
Com o banco PostgreSQL ativo:
```bash
cd backend
alembic upgrade head
```

#### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

---

## 🧪 Testes Automatizados

O backend possui suíte de testes com banco em memória (`SQLite in-memory`) para garantir isolamento e alta velocidade:

```bash
cd backend
venv\Scripts\pytest tests -v
```

Cobertura inicial da Etapa 1:
- `test_register_user`: Cadastro de novo usuário e perfil de aprendizado inicial.
- `test_register_duplicate_email`: Rejeição de e-mails duplicados.
- `test_login_success`: Emissão de JWT Bearer Token.
- `test_login_invalid_password`: Bloqueio de senhas incorretas.
- `test_get_me_authenticated`: Leitura segura do perfil autenticado.
- `test_get_me_unauthorized`: Bloqueio a rotas privadas sem token.

---

## 🌐 Deploy em Produção (Vercel + Render)

A aplicação já está 100% preparada para hospedagem gratuita/escalável:
- **Backend + Banco de Dados:** [Render](https://render.com)
- **Frontend SPA:** [Vercel](https://vercel.com)

### 1. Deploy do Backend no Render
1. Crie uma conta no [Render](https://render.com) e conecte seu repositório GitHub.
2. Clique em **New +** e selecione **Blueprint**.
3. Selecione este repositório. O Render detectará automaticamente o arquivo [`render.yaml`](file:///c:/Users/letti/OneDrive/Documentos/Projetos%20Anderson/ProjetoInglesMusica/render.yaml):
   - Criará a instância do **PostgreSQL** (`fluencycast-db`).
   - Criará o **Web Service** Python (`fluencycast-backend`).
   - Conectará o `DATABASE_URL` automaticamente e executará as migrações do Alembic no build (`alembic upgrade head`).
4. Após o deploy, anote a URL pública gerada (exemplo: `https://fluencycast-backend.onrender.com`).

### 2. Deploy do Frontend no Vercel
1. Crie uma conta na [Vercel](https://vercel.com) e importe o repositório.
2. Na configuração do projeto:
   - **Root Directory:** selecione a pasta `frontend`.
   - **Framework Preset:** Vite.
   - **Environment Variables:**
     - `VITE_API_URL`: insira a URL do seu backend no Render (exemplo: `https://fluencycast-backend.onrender.com`).
3. Clique em **Deploy**. O arquivo [`vercel.json`](file:///c:/Users/letti/OneDrive/Documentos/Projetos%20Anderson/ProjetoInglesMusica/frontend/vercel.json) já está configurado para garantir o roteamento correto de SPA (sem erros 404 ao atualizar a página).

---

## 📋 Próximas Etapas

- [x] **ETAPA 1:** Arquitetura, FastAPI, PostgreSQL, Alembic, JWT, React TS, PWA, CSS Puro, Docker.
- [ ] **ETAPA 2:** Validação de URL do YouTube, extração de metadados, processamento e segmentação da transcrição.
- [ ] **ETAPA 3:** Player interativo do YouTube (IFrame API) com sincronização em tempo real da transcrição e auto-scroll.
- [ ] **ETAPA 4:** Seleção e salvamento de frases em contexto com tradução e categorização.
- [ ] **ETAPA 5:** Repetição espaçada dinâmica (SRS SM-2) e cálculo de revisões diárias.
- [ ] **ETAPA 6:** Integração com IA para explicações gramaticais e geração de exercícios práticos.
