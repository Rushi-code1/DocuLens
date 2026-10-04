# 📄 DocuLens — AI Document Intelligence & Assistant

> An AI-powered document intelligence and interactive reader platform that extracts structured data and answers grounded questions from PDFs, Markdown, and text documents using **Django**, **LangChain**, **LangGraph**, and **Google Gemini** — featuring a modern **React.js** dashboard with native text selection.

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![Django](https://img.shields.io/badge/Django-6.1-092E20?logo=django&logoColor=white)](https://djangoproject.com)
[![LangChain](https://img.shields.io/badge/LangChain-0.3-1C3C3C?logo=langchain&logoColor=white)](https://langchain.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-FF6F00?logo=diagram-project&logoColor=white)](https://langchain-ai.github.io/langgraph/)
[![Google Gemini](https://img.shields.io/badge/Gemini-3.1_Flash--Lite-4285F4?logo=google&logoColor=white)](https://ai.google.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🚀 Key Features

* **AI-Powered Structured Extraction** — Automatically generates an executive brief, core themes, and tailored questions on upload using `llm.with_structured_output(DocumentSummary)`.
* **Native PDF Canvas & Text Selection** — Overlays an interactive text layer on top of Mozilla PDF.js canvas, letting users highlight any sentence to trigger the floating *"Ask AI"* / *"Set as Context"* popover.
* **Agentic LangGraph Orchestration** — Stateful multi-node execution graph with dynamic routing, self-correcting feedback loops, and strict cost controls.
* **Corrective RAG (CRAG) & Document Grading** — Evaluates retrieved chunks with an LLM-as-a-judge to filter out irrelevant noise before synthesis.
* **Adaptive Query Rewriting Loop** — Automatically reformulates vague, colloquial, or jargon-heavy queries into search-optimized terms with a token-capped feedback loop.
* **Zero-Leakage Web Search Fallback** — When document context is insufficient, queries external search using strictly standalone queries (never leaks document text or chunks).
* **Self-RAG Local Factuality Gate** — Sub-2ms, zero-token local Python grounding verifier that intercepts hallucinations and ungrounded numbers on the CPU before delivery.
* **Multi-Tenant Security** — ChromaDB vector store partitioned by user and document ID with metadata isolation.
* **Enterprise Django Backend** — SQLite ORM persistence for documents, sessions, and chat history with JWT authentication.
* **Modern React 19 Workspace** — Built with Vite 8 and Tailwind CSS, featuring full dark/light mode, collapsible history sidebar, and rich Markdown parsing.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Client [Frontend Workspace]
        UI[React 19 Dashboard\nPDF.js Canvas + Selectable TextLayer]
    end

    subgraph BackendServer [Django REST Framework]
        Auth[JWT Authentication & Multi-Tenant Guard]
        ORM[(SQLite DB\nUsers, Documents, Chat History)]
    end

    subgraph AgenticEngine [LangGraph State Machine Engine]
        Router{Intent Router}
        Direct[Direct Greeting Generator]
        ChromaStore[(ChromaDB Vector Store\nIsolated by user_id & doc_id)]
        Grader{CRAG Document Grader}
        Rewriter[Adaptive Query Rewriter\nMax 1 Retry Guard]
        WebTool[Zero-Leakage Web Search Fallback\nStandalone Query Only]
        Generator[Grounded Generator\nGemini 3.1 Flash-Lite]
        SelfRAGGate{Self-RAG Tier 1 Local Verifier\nCPU Grounding Check <2ms}
        StrictGen[Strict Zero-Temp Regenerator]
    end

    UI <-->|JWT Bearer Requests| Auth
    Auth <--> ORM
    Auth <--> AgenticEngine

    AgenticEngine --> Router
    Router -->|Pleasantry / Chit-Chat| Direct --> FinalResponse([Deliver Response])
    Router -->|Document Question| ChromaStore
    ChromaStore --> Grader

    Grader -->|Relevant Chunks Found| Generator
    Grader -->|No Context & Retry < 1| Rewriter --> ChromaStore
    Grader -->|No Context & Retry >= 1| WebTool --> FinalResponse

    Generator --> SelfRAGGate
    SelfRAGGate -->|Grounded & Factual| FinalResponse
    SelfRAGGate -->|Hallucination & Retry < 1| StrictGen --> SelfRAGGate
    SelfRAGGate -->|Retry Exceeded| FinalResponse
```

---

## 🛠️ Tech Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend Framework** | Django 6 + Django REST Framework | REST APIs, authentication, file storage, and data modeling |
| **Auth System** | `djangorestframework-simplejwt` | Token-based JSON Web Token (JWT) access & refresh tokens |
| **Agentic Graph** | LangGraph 0.2 + LangChain 0.3 | Cyclic state machines with dynamic routing, CRAG, and Self-RAG |
| **LLM & Embeddings** | Google Gemini (`gemini-3.1-flash-lite`) | Sub-second generative inference and semantic embeddings |
| **Local Verification Gate** | Pure Python Regex & Set Grounding | Sub-2ms local CPU numerical and factuality validator |
| **Vector Database** | ChromaDB | Local vector store with multi-tenant metadata filtering |
| **External Search Tool** | Privacy-Preserving Web Fallback | Dispatches standalone queries when document is silent |
| **Frontend Framework** | React 19 + Vite 8 | Reactive component state, instant HMR, and modular design |
| **PDF Rendering** | Mozilla PDF.js v3.11 | High-DPI canvas rendering with interactive selectable text overlay |
| **Styling** | Tailwind CSS + Lucide Icons | Responsive UI with off-white warm paper aesthetic and dark mode |
| **Markdown Parser** | Marked.js | Renders bold text, code blocks, lists, and tables inside chat bubbles |

---

## 📂 Project Structure

```
DocsLens/
├── backend/                       # Django REST API Backend
│   ├── manage.py
│   ├── doculens_server/           # Project settings, CORS, JWT & URL routing
│   │   ├── settings.py
│   │   └── urls.py
│   └── core/                      # Application core
│       ├── models.py              # User, Document, and ChatMessage ORM models
│       ├── serializers.py         # DRF Serializers for auth, documents & messages
│       ├── views.py               # REST API views with permission checks
│       ├── graph_rag.py           # LangGraph StateGraph (CRAG + Rewriter + Self-RAG)
│       ├── rag_service.py         # Document chunking, indexing & Chroma vectorstore
│       └── urls.py                # Core endpoints routing
│
├── frontend/                      # Vite + React 19 Frontend
│   ├── index.html                 # App shell, fonts & PDF.js styling
│   ├── src/
│   │   ├── api.js                 # API service with automatic JWT Bearer injection
│   │   ├── context/
│   │   │   └── AuthContext.jsx    # User login, registration & session state
│   │   ├── components/
│   │   │   ├── Navbar.jsx         # Header with theme toggle & user badge
│   │   │   ├── Sidebar.jsx        # Saved documents list & upload action
│   │   │   ├── PdfViewer.jsx      # PDF.js visual canvas with selectable text layer
│   │   │   ├── ChatWorkspace.jsx  # Markdown chat feed, suggested questions & input
│   │   │   └── AuthModal.jsx      # Sign In / Create Account modal
│   │   ├── App.jsx                # Main layout orchestrator
│   │   └── main.jsx
│
├── .env.example                   # Environment variables template
├── .gitignore                     # Git ignore rules for Python, Django, Node, and secrets
├── requirements.txt               # Backend Python dependencies
└── README.md                      # Project documentation
```

---

## ⚡ Quickstart

### Prerequisites
* **Python 3.11+** installed
* **Node.js 18+** installed
* Google Gemini API Key from Google AI Studio

---

### 1. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your Gemini API key in `.env`:
```env
GOOGLE_API_KEY="your-google-gemini-api-key"
```

---

### 2. Backend Setup (Django)

In your terminal:

```bash
cd backend

# Apply database migrations
python manage.py migrate

# Start the Django development server
python manage.py runserver 127.0.0.1:8000
```

---

### 3. Frontend Setup (Vite + React)

In a second terminal:

```bash
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev
```

Access the frontend via your local development server.

---

## 📡 API Endpoints

All core endpoints are exposed under the `/api/` routing namespace:

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register/` | Register new user account | No |
| `POST` | `/api/auth/login/` | Obtain JWT access and refresh tokens | No |
| `POST` | `/api/auth/refresh/` | Refresh expired access token | No |
| `GET` | `/api/auth/me/` | Fetch current user profile | Yes (Bearer) |
| `GET` | `/api/documents/` | List all documents uploaded by user | Yes (Bearer) |
| `POST` | `/api/documents/upload/` | Upload document, chunk, embed & generate summary | Yes (Bearer) |
| `GET` | `/api/documents/<id>/` | Fetch document metadata and full text | Yes (Bearer) |
| `DELETE` | `/api/documents/<id>/` | Delete document and associated chats | Yes (Bearer) |
| `GET` | `/api/documents/<id>/messages/` | Fetch chat history for document | Yes (Bearer) |
| `POST` | `/api/documents/<id>/ask/` | Ask question with LangGraph agentic reasoning | Yes (Bearer) |

---

## 🧭 10-Day LangChain/LangGraph Roadmap

* [x] **Day 1: Naive RAG & Document Splitting** — Chunking strategies, token awareness, Chroma storage.
* [x] **Day 2: Vector Stores & Semantic Retrievers** — MMR retrieval, similarity relevance filtering.
* [x] **Day 3: LCEL & Structured Outputs (Pydantic)** — Pydantic schema enforcement, auto-summary generation.
* [x] **Enterprise Milestone: Architecture Migration** — Django + SimpleJWT + SQLite + React 19 / Vite.
* [x] **Day 4: LangGraph State & Nodes** — State machines, typed graph state, linear workflows.
* [x] **Day 5: Conditional Branching & Dynamic Routing** — Query router, CRAG relevance grader, and state reducers.
* [x] **Day 6: Visualization, Streaming & State Inspection** — Token-focused SSE streaming patterns & graph trajectory inspection.
* [x] **Day 7: Corrective RAG (CRAG) Loops** — Adaptive query rewriting, self-correction feedback loop, and loop guardrails.
* [x] **Day 8: Privacy-Preserving Web Search Fallback** — External web tool fallback without document text leakage.
* [x] **Day 9: Self-RAG (Hallucination Detection)** — Tier 1 local CPU factuality gate and strict zero-temperature regeneration.
* [ ] **Day 10: Multi-Turn Memory with Checkpointers** — Conversation threads with persistent SQLite checkpointers.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
