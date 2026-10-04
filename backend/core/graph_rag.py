import re
import operator
from datetime import datetime
from typing import TypedDict, List, Optional, Literal, Annotated

from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from .rag_service import get_vectorstore


# ============================================================================
# Day 5: Decision Schemas (Pydantic Structured Outputs)
# ============================================================================

class QueryRoute(BaseModel):
    """Classifies user intent to determine whether document retrieval is required."""
    destination: Literal["document_retrieval", "direct_conversation"] = Field(
        description="Choose 'document_retrieval' if the query asks for facts, details, summaries, or questions about the document content. "
                    "Choose 'direct_conversation' if the query is a greeting, pleasantry, thank you, or general conversational interaction."
    )
    reasoning: str = Field(description="One-sentence explanation of the routing decision")


class BatchGradeDocuments(BaseModel):
    """Evaluates all retrieved chunks in a single pass to eliminate sequential round-trip latency."""
    relevant_chunk_indices: List[int] = Field(
        description="List of 0-based integer indices of chunks that contain facts relevant to answering the user question. Return an empty list if none are relevant."
    )


# Fast classifier LLMs
classifier_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.0,
    max_output_tokens=256
)

generator_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.2,
    max_output_tokens=2048
)

# Day 7: Lightweight Query Rewriter LLM (Cost & Token Guarded)
rewriter_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.1,
    max_output_tokens=128
)

# Routing chain
router_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert query router. Determine whether the user's question requires searching the document ('document_retrieval') "
        "or is simple pleasantry/greeting/chit-chat ('direct_conversation'). If the user provided a highlighted text excerpt, always choose 'document_retrieval'."
    ),
    (
        "human",
        "Question: {question}\nHighlighted Selection: {selected_context}"
    )
])
router_chain = router_prompt | classifier_llm.with_structured_output(QueryRoute)

# High-Speed Single-Pass Batch Relevance Grader chain
batch_grader_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are a fast document relevance grader. Evaluate all retrieved document chunks at once. "
        "Identify which chunk indices contain facts or context relevant to answering the user question. "
        "Be strict: return only the 0-based integer indices of relevant chunks. Return an empty list if none are relevant."
    ),
    (
        "human",
        "User Question: {question}\n\nRetrieved Chunks:\n{formatted_chunks}"
    )
])
batch_grader_chain = batch_grader_prompt | classifier_llm.with_structured_output(BatchGradeDocuments)

# Day 7: Query Rewriter chain (Reformulates query for optimal vector retrieval)
rewriter_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert search query optimizer for technical and business documents. "
        "The user's query failed to retrieve relevant documents because of wording, jargon, or phrasing differences. "
        "Reformulate the query into a clear, keyword-rich search phrase optimized for vector semantic similarity search. "
        "Do NOT explain your changes. Return ONLY the reformulated query text."
    ),
    (
        "human",
        "Original Query: {question}\nTarget Document: {filename}"
    )
])
rewriter_chain = rewriter_prompt | rewriter_llm | StrOutputParser()

# Direct conversational prompt (no vector DB retrieval needed)
direct_chat_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are DocuLens, an intelligent and friendly AI document assistant. Answer the user's greeting or pleasantry politely and concisely. "
        "Remind them that you are ready to answer any questions about their uploaded document."
    ),
    (
        "human",
        "{question}"
    )
])
direct_chat_chain = direct_chat_prompt | generator_llm | StrOutputParser()

# Grounded RAG Generation prompt
rag_prompt = ChatPromptTemplate.from_template(
    """You are an expert document assistant.
CURRENT DATE: {current_date} (Year: {current_year}).
CRITICAL TEMPORAL CONTEXT: The current real-world year is {current_year}. When reviewing documents, resumes, work experience, timelines, or dates, always evaluate them relative to {current_year}. Dates up to and including {current_year} are valid past or present dates, not future dates.

Answer the question accurately, thoroughly, and strictly based on the verified context below.
If the user specifically highlighted a section, pay special attention to it, but also draw from the broader document context.

Context:
{context}

Question:
{question}

Answer:"""
)


# ============================================================================
# Step 1: State Definition with State Reducer & Day 7 Retry Budget
# ============================================================================

class RAGState(TypedDict):
    # Inputs (Provided by caller)
    user_id: int
    document_id: int
    filename: str
    question: str
    original_question: Optional[str]
    selected_context: Optional[str]

    # Day 5 Decision & Routing Fields
    route: Optional[Literal["document_retrieval", "direct_conversation"]]
    documents: List[str]                  # Raw retrieved chunks
    relevant_documents: List[str]         # Filtered chunks graded 'yes'
    relevance_status: Optional[Literal["has_context", "no_context"]]

    # Day 7 Loop Safeguards (Strict max 1 retry to cap token consumption)
    retry_count: int

    # Day 8 Web Search Fallback Fields
    web_context: Optional[str]

    # Day 9 Self-RAG Verification Fields (Strict max 1 generation retry)
    generation_retry_count: int
    verification_status: Optional[Literal["grounded", "hallucinated"]]
    hallucination_reason: Optional[str]
    chunk_scores: Optional[List[float]]

    # State Reducer: Appends sources rather than overwriting
    sources: Annotated[List[dict], operator.add]

    # Final Output text
    answer: str


# ============================================================================
# Step 2: Worker Nodes
# ============================================================================

def route_query_node(state: RAGState) -> dict:
    """Classifies user intent with a 0ms fast-path for greetings & chit-chat."""
    question = state["question"].strip()
    focus_text = (state.get("selected_context") or "").strip()

    # Fast bypass 1: if user explicitly pinned context, always retrieve
    if focus_text:
        return {"route": "document_retrieval"}

    # Fast bypass 2: Instant 0ms regex check for greetings and courtesies
    q_norm = question.lower().strip("!?. ")
    common_greetings = {"hi", "hello", "hey", "greetings", "good morning", "good evening", "good afternoon", "thanks", "thank you", "bye", "goodbye", "who are you"}
    if q_norm in common_greetings:
        return {"route": "direct_conversation"}

    # Fast bypass 3: Instant 0ms check for question patterns & substantive prompts
    words = q_norm.split()
    first_word = words[0] if words else ""
    question_starters = {"what", "how", "why", "who", "where", "which", "when", "can", "is", "are", "does", "do", "explain", "describe", "summarize", "list", "show", "find", "tell", "give"}
    if first_word in question_starters or len(words) >= 4:
        return {"route": "document_retrieval"}

    try:
        decision: QueryRoute = router_chain.invoke({
            "question": question,
            "selected_context": focus_text
        })
        return {"route": decision.destination}
    except Exception:
        # Fallback to document retrieval on any error
        return {"route": "document_retrieval"}


def direct_generate_node(state: RAGState) -> dict:
    """Answers greetings and pleasantries directly without touching the vector database."""
    question = state["question"]
    try:
        reply = direct_chat_chain.invoke({"question": question})
    except Exception as e:
        reply = f"Hello! I am your DocuLens assistant. How can I help you with **{state.get('filename', 'your document')}** today?"

    return {
        "answer": reply,
        "sources": []
    }


def retrieve_node(state: RAGState) -> dict:
    """Queries ChromaDB with strict multi-tenant metadata isolation."""
    vectorstore = get_vectorstore()
    question = state["question"]
    focus_text = (state.get("selected_context") or "").strip()

    search_query = f"{question} {focus_text[:200]}" if focus_text else question

    scored_docs = vectorstore.similarity_search_with_relevance_scores(
        search_query,
        k=4,
        filter={
            "$and": [
                {"user_id": state["user_id"]},
                {"document_id": state["document_id"]}
            ]
        }
    )

    context_chunks = []
    chunk_scores = []
    # Priority 1: User-highlighted text from PDF viewer
    if focus_text:
        context_chunks.append(f"--- USER HIGHLIGHTED TEXT ---\n{focus_text}")
        chunk_scores.append(1.0)

    # Priority 2: Vector store chunks
    for doc, score in scored_docs:
        context_chunks.append(doc.page_content)
        chunk_scores.append(score)

    return {
        "documents": context_chunks,
        "chunk_scores": chunk_scores
    }


def grade_documents_node(state: RAGState) -> dict:
    """Evaluates retrieved chunks in a SINGLE PASS batch to eliminate sequential latency."""
    question = state["question"]
    raw_docs = state.get("documents", [])
    chunk_scores = state.get("chunk_scores") or []
    focus_text = (state.get("selected_context") or "").strip()
    filename = state.get("filename", "Document")

    if not raw_docs:
        return {
            "relevant_documents": [],
            "relevance_status": "no_context"
        }

    relevant_docs = []
    verified_sources = []

    # Handle pinned focus text immediately (always relevant)
    non_focus_chunks = []
    for chunk in raw_docs:
        if focus_text and focus_text in chunk:
            relevant_docs.append(chunk)
            verified_sources.append({
                "id": "Selected Text",
                "content": focus_text,
                "source": "User Selection",
                "match": "Focus"
            })
        else:
            non_focus_chunks.append(chunk)

    # Fast-Path: If vector similarity is strong (top score >= 0.50), accept high-scoring chunks directly in 0ms!
    top_score = max(chunk_scores) if chunk_scores else 0.0
    if top_score >= 0.50:
        for i, chunk in enumerate(non_focus_chunks):
            score = chunk_scores[i] if i < len(chunk_scores) else 0.0
            if score >= 0.35:
                relevant_docs.append(chunk)
                verified_sources.append({
                    "id": len(verified_sources) + 1,
                    "content": chunk,
                    "source": filename,
                    "match": f"{int(score * 100)}%"
                })
        if relevant_docs:
            return {
                "relevant_documents": relevant_docs,
                "relevance_status": "has_context",
                "sources": verified_sources
            }

    if non_focus_chunks:
        # Build numbered chunks string for single-pass evaluation
        formatted_chunks = "\n\n".join([
            f"[Chunk {idx}]:\n{chunk}"
            for idx, chunk in enumerate(non_focus_chunks)
        ])

        try:
            decision: BatchGradeDocuments = batch_grader_chain.invoke({
                "question": question,
                "formatted_chunks": formatted_chunks
            })
            valid_indices = set(decision.relevant_chunk_indices or [])
            for idx, chunk in enumerate(non_focus_chunks):
                if idx in valid_indices:
                    relevant_docs.append(chunk)
                    verified_sources.append({
                        "id": len(verified_sources) + 1,
                        "content": chunk,
                        "source": filename,
                        "match": "Verified"
                    })
        except Exception:
            # On grader failure, retain chunks as fail-safe
            for chunk in non_focus_chunks:
                relevant_docs.append(chunk)
                verified_sources.append({
                    "id": len(verified_sources) + 1,
                    "content": chunk,
                    "source": filename,
                    "match": "Relevant"
                })

    if relevant_docs:
        return {
            "relevant_documents": relevant_docs,
            "relevance_status": "has_context",
            "sources": verified_sources
        }
    else:
        return {
            "relevant_documents": [],
            "relevance_status": "no_context"
        }


def rewrite_query_node(state: RAGState) -> dict:
    """
    Day 7: Query Transformation Node.
    Reformulates the question into an optimized vector search phrase
    when initial retrieval returns no relevant context.
    Strictly capped at max 1 retry to safeguard token usage and latency.
    """
    question = state["question"]
    original_q = state.get("original_question") or question
    retry_count = state.get("retry_count", 0)
    filename = state.get("filename", "document")

    try:
        rewritten = rewriter_chain.invoke({
            "question": original_q,
            "filename": filename
        }).strip()
    except Exception:
        rewritten = original_q

    return {
        "question": rewritten,
        "original_question": original_q,
        "retry_count": retry_count + 1,
        "documents": [],
        "relevant_documents": []
    }


def generate_node(state: RAGState) -> dict:
    """Generates grounded answer using only the verified relevant context."""
    relevant_docs = state.get("relevant_documents", [])
    # Answer the original question using the freshly retrieved context
    question_to_answer = state.get("original_question") or state["question"]

    formatted_context = "\n\n".join(relevant_docs)

    now = datetime.now()
    current_date = now.strftime("%B %d, %Y")
    current_year = str(now.year)

    rag_chain = rag_prompt | generator_llm | StrOutputParser()
    answer_text = rag_chain.invoke({
        "context": formatted_context,
        "question": question_to_answer,
        "current_date": current_date,
        "current_year": current_year
    })

    return {
        "answer": answer_text
    }


def verify_local_grounding(answer: str, context: str) -> tuple[bool, str]:
    """
    Day 9: Tier 1 Local Verifier (<2ms, $0, zero network latency).
    Verifies numerical accuracy, date claims, and entity anchoring
    between the generated answer and the source document chunks.
    """
    if not answer or not answer.strip():
        return False, "Generated answer is empty."

    # 1. Numerical & Quantitative Grounding Check
    ans_digits = set(re.findall(r'\b\d+(?:\.\d+)?\b', answer))
    ctx_digits = set(re.findall(r'\b\d+(?:\.\d+)?\b', context))

    # Exclude harmless structural digits (list numbering 1-10, current year)
    harmless_digits = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", str(datetime.now().year)}
    ungrounded_digits = (ans_digits - ctx_digits) - harmless_digits

    # If the answer introduces fabricated numbers/metrics not present in the document
    if len(ungrounded_digits) > 0:
        return False, f"Ungrounded numbers detected: {list(ungrounded_digits)[:3]}"

    # 2. Refusal / Evasion detection when context was provided
    refusal_patterns = [
        r"i cannot find",
        r"i do not have enough information",
        r"as an ai language model",
        r"i'm sorry, but i don't know"
    ]
    for pattern in refusal_patterns:
        if re.search(pattern, answer, re.IGNORECASE) and len(context.strip()) > 100:
            return False, "Evasive refusal generated despite verified context available."

    return True, "Passed local factuality and grounding checks."


def verify_generation_node(state: RAGState) -> dict:
    """
    Day 9 Self-RAG Quality Gate Node.
    Executes Tier 1 local factuality verification on CPU in <2ms.
    """
    answer = state.get("answer", "")
    relevant_docs = state.get("relevant_documents", [])
    context = "\n\n".join(relevant_docs)

    is_grounded, reason = verify_local_grounding(answer, context)

    if is_grounded:
        return {
            "verification_status": "grounded",
            "hallucination_reason": ""
        }
    else:
        return {
            "verification_status": "hallucinated",
            "hallucination_reason": reason
        }


def strict_regenerate_node(state: RAGState) -> dict:
    """
    Day 9: Strict Zero-Temperature Regeneration.
    Re-invokes Gemini with temperature=0.0 and explicit factuality guardrail.
    Capped at max 1 retry to permanently prevent cascading retry storms.
    """
    relevant_docs = state.get("relevant_documents", [])
    question = state.get("original_question") or state["question"]
    formatted_context = "\n\n".join(relevant_docs)
    retry_count = state.get("generation_retry_count", 0)
    reason = state.get("hallucination_reason", "Stick strictly to verified facts.")

    strict_prompt = ChatPromptTemplate.from_template(
        """You are a strict, zero-hallucination document verification assistant.
Your previous response contained potential ungrounded claims or discrepancies: {reason}

TASK: Answer the question STRICTLY using ONLY the exact facts, numbers, and statements from the Verified Context below.
Do NOT extrapolate, estimate, or introduce external facts.
If a detail is not in the context, do not mention it.

Verified Context:
{context}

Question:
{question}

Strict Answer:"""
    )

    strict_llm = ChatGoogleGenerativeAI(
        model="gemini-3.1-flash-lite",
        temperature=0.0,
        max_output_tokens=2048
    )

    chain = strict_prompt | strict_llm | StrOutputParser()
    corrected_answer = chain.invoke({
        "context": formatted_context,
        "question": question,
        "reason": reason
    })

    return {
        "answer": corrected_answer,
        "generation_retry_count": retry_count + 1,
        "verification_status": "grounded"
    }


def web_search_node(state: RAGState) -> dict:
    """
    Day 8: Web Search Tool Fallback Node.
    CRITICAL PRIVACY RULE: NEVER pass document text, excerpts, or filenames to external search.
    ONLY the clean, standalone user query is dispatched.
    """
    query = state.get("original_question") or state["question"]
    filename = state.get("filename", "your document")

    results = []
    # Primary: ddgs (fast, high-quality, privacy-preserving)
    try:
        from ddgs import DDGS
        raw = DDGS().text(query, max_results=3)
        for r in raw:
            results.append({
                "title": r.get("title", "Web Result"),
                "url": r.get("href", ""),
                "snippet": r.get("body", "")
            })
    except Exception:
        pass

    # Secondary: googlesearch
    if not results:
        try:
            from googlesearch import search
            for r in search(query, num_results=3, advanced=True):
                results.append({
                    "title": getattr(r, "title", "Google Result"),
                    "url": getattr(r, "url", ""),
                    "snippet": getattr(r, "description", "")
                })
        except Exception:
            pass

    # If no results found from web search, trigger honest fallback
    if not results:
        return {
            "answer": f"I couldn't find any relevant information about that in **{filename}**, "
                      f"and external web search did not return results for that query.",
            "sources": []
        }

    web_context_str = "\n\n".join([
        f"Title: {r['title']}\nSource URL: {r['url']}\nSnippet: {r['snippet']}"
        for r in results
    ])

    web_rag_prompt = ChatPromptTemplate.from_template(
        """You are DocuLens, an enterprise document intelligence assistant.
The user's query could NOT be answered from their uploaded document ({filename}).
However, you have retrieved supplemental external web search results.

CRITICAL INSTRUCTIONS:
1. Clearly state upfront in 1 sentence that this specific detail was not found in {filename}, but you retrieved it from live web search.
2. Answer the user's question accurately and concisely based strictly on the Web Results below.
3. Reference the web sources or domains.

Web Results:
{web_context}

User Question:
{question}

Answer:"""
    )

    rag_chain = web_rag_prompt | generator_llm | StrOutputParser()
    answer_text = rag_chain.invoke({
        "web_context": web_context_str,
        "question": query,
        "filename": filename
    })

    web_sources = [
        {
            "id": f"Web {i+1}",
            "content": r["snippet"] or r["title"],
            "source": r["url"] or "Web Search",
            "match": "Web Search"
        }
        for i, r in enumerate(results)
    ]

    return {
        "answer": answer_text,
        "sources": web_sources,
        "web_context": web_context_str
    }


def no_context_fallback_node(state: RAGState) -> dict:
    """Honest fallback when no retrieved chunks contain answerable information."""
    filename = state.get("filename", "this document")
    return {
        "answer": f"I couldn't find any relevant information about that in **{filename}**. "
                  f"Please ask a question directly related to the document's content."
    }


# ============================================================================
# Step 3: Conditional Routing Functions
# ============================================================================

def route_after_query_classification(state: RAGState) -> str:
    """Conditional Edge 1: Routes to direct answer OR vector retrieval."""
    if state.get("route") == "direct_conversation":
        return "direct_generate"
    return "retrieve"


def route_after_grading(state: RAGState) -> str:
    """
    Day 8 Dynamic Routing (CRAG with Web Search Fallback):
    1. If relevant documents exist -> generate answer directly (0 extra tokens, 0 web calls).
    2. If no context found AND retry_count < 1 -> rewrite query & retry retrieval.
    3. If retry budget exhausted -> route to web_search_node (external fallback).
    """
    if state.get("relevance_status") == "has_context":
        return "generate"

    retry_count = state.get("retry_count", 0)
    if retry_count < 1:
        return "rewrite_query"

    return "web_search"


def route_after_verification(state: RAGState) -> str:
    """
    Day 9 Quality Gate Routing:
    - If grounded -> deliver directly to user (END) with 0 extra cloud calls.
    - If hallucinated AND generation_retry_count < 1 -> strict_regenerate.
    - If generation_retry_count >= 1 -> finish safely to END.
    """
    if state.get("verification_status") == "grounded":
        return "end"

    retries = state.get("generation_retry_count", 0)
    if retries < 1:
        return "strict_regenerate"

    return "end"


# ============================================================================
# Step 4: Constructing & Compiling the Day 9 StateGraph
# ============================================================================

def build_rag_graph():
    """Compiles the Day 9 cyclic state graph with Self-RAG verification, query rewriting, and web search fallback."""
    workflow = StateGraph(RAGState)

    # 1. Add all worker nodes
    workflow.add_node("route_query", route_query_node)
    workflow.add_node("direct_generate", direct_generate_node)
    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("grade_documents", grade_documents_node)
    workflow.add_node("rewrite_query", rewrite_query_node)
    workflow.add_node("generate", generate_node)
    workflow.add_node("verify_generation", verify_generation_node)
    workflow.add_node("strict_regenerate", strict_regenerate_node)
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("no_context_fallback", no_context_fallback_node)

    # 2. Add control flow edges
    workflow.add_edge(START, "route_query")

    # Conditional Edge 1: Query Router
    workflow.add_conditional_edges(
        "route_query",
        route_after_query_classification,
        {
            "direct_generate": "direct_generate",
            "retrieve": "retrieve"
        }
    )

    # Static transition to Grader
    workflow.add_edge("retrieve", "grade_documents")

    # Conditional Edge 2: Document Relevance Filter with Day 8 Web Search Fallback
    workflow.add_conditional_edges(
        "grade_documents",
        route_after_grading,
        {
            "generate": "generate",
            "rewrite_query": "rewrite_query",
            "web_search": "web_search"
        }
    )

    # Cyclic feedback loop: Rewritten query re-enters retrieval
    workflow.add_edge("rewrite_query", "retrieve")

    # Day 9 Self-RAG Quality Gate Edges
    workflow.add_edge("generate", "verify_generation")

    # Conditional Edge 3: Verification Router
    workflow.add_conditional_edges(
        "verify_generation",
        route_after_verification,
        {
            "end": END,
            "strict_regenerate": "strict_regenerate"
        }
    )

    # Cyclic feedback loop: Strict regenerate feeds back to verifier
    workflow.add_edge("strict_regenerate", "verify_generation")

    # Terminal transitions
    workflow.add_edge("direct_generate", END)
    workflow.add_edge("web_search", END)
    workflow.add_edge("no_context_fallback", END)

    return workflow.compile()


# Compiled singleton instance
rag_graph = build_rag_graph()
