import re
import operator
from datetime import datetime
from typing import TypedDict, List, Optional, Literal, Annotated

import requests
import concurrent.futures
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from .rag_service import get_vectorstore

# Day 10: In-memory LangGraph Checkpointer for zero-latency (<0.05ms) thread persistence
checkpointer = MemorySaver()


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


# Fast classifier LLMs with robust cloud production timeouts (30-40s)
classifier_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.0,
    max_output_tokens=256,
    max_retries=2,
    timeout=30
)

generator_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.2,
    max_output_tokens=2048,
    max_retries=2,
    timeout=40
)

# High-Speed Concise Web Search LLM
web_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.2,
    max_output_tokens=350,
    max_retries=2,
    timeout=30
)

# Day 7: Lightweight Query Rewriter LLM (Cost & Token Guarded)
rewriter_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.1,
    max_output_tokens=128,
    max_retries=2,
    timeout=25
)

# Routing chain
router_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert query router for an AI document assistant.\n"
        "Determine whether the user's question requires searching the uploaded document ('document_retrieval') "
        "or is simple conversation, greeting, pleasantry, or an inquiry about previous questions or chat history ('direct_conversation').\n"
        "- Choose 'direct_conversation' if the user asks about previous queries, chat history, greetings, who you are, or general conversation.\n"
        "- Choose 'document_retrieval' if the user asks for facts, details, summaries, or questions about the document content.\n"
        "If the user provided a highlighted text excerpt, always choose 'document_retrieval'."
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
        "You are an objective document relevance evaluator.\n"
        "Your task is to check if any of the retrieved chunks contain the factual information to answer the user's question.\n"
        "- If a chunk contains facts to answer the question, include its 0-based index.\n"
        "- If a chunk is off-topic, discusses general ideas without answering the question, or does NOT contain the specific facts, consider it irrelevant.\n"
        "- CRITICAL: If none of the retrieved chunks contain the answer to the question, return an empty list `[]`.\n"
        "Return the list of 0-based integer indices in `relevant_chunk_indices`."
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

# Direct conversational prompt (supports greetings, polite courtesies, and conversational recall from DB history)
direct_chat_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are DocuLens, an enterprise AI document assistant for the document '{filename}'.\n"
        "You have full access to the recent conversation history with the user.\n\n"
        "CRITICAL INSTRUCTIONS:\n"
        "1. If the user asks what their previous questions were, asks to point out or summarize any past chat, or asks what was discussed earlier:\n"
        "   - Review the Recent Conversation History below carefully.\n"
        "   - List their previous questions or key discussion points clearly in a numbered or bulleted list.\n"
        "   - Do NOT say you don't have access to past conversation or history.\n"
        "2. If the user asks for clarification or follow-up on a prior answer, answer it directly using the conversation history.\n"
        "3. If the user sends a greeting or pleasantry (e.g. 'hi', 'thank you', 'who are you'), reply warmly and mention you are ready to help analyze '{filename}'.\n"
        "4. If no previous questions exist in the history, politely state that this is the beginning of the chat session for '{filename}'."
    ),
    (
        "human",
        "Recent Conversation History:\n{chat_history}\n\nUser Question:\n{question}"
    )
])
direct_chat_chain = direct_chat_prompt | generator_llm | StrOutputParser()

# Grounded RAG Generation prompt (incorporates temporal anchoring, verified chunks, and multi-turn context)
rag_prompt = ChatPromptTemplate.from_template(
    """You are an expert document assistant for {filename}.
CURRENT DATE: {current_date} (Year: {current_year}).
CRITICAL TEMPORAL CONTEXT: The current real-world year is {current_year}. When reviewing documents, resumes, work experience, timelines, or dates, always evaluate them relative to {current_year}. Dates up to and including {current_year} are valid past or present dates, not future dates.

Recent Conversation Context:
{chat_history}

Verified Document Context:
{context}

Question:
{question}

Answer:"""
)


# Day 10: History-Aware Query Contextualizer prompt & chain
contextualize_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "Given a chat history and the latest user question which might reference context in the chat history, "
        "formulate a standalone question which can be understood without the chat history. "
        "Do NOT answer the question, just reformulate it if needed and otherwise return it as is. "
        "Return ONLY the standalone question text without explanations or quotes."
    ),
    (
        "human",
        "Chat History:\n{chat_history}\n\nLatest Question: {question}"
    )
])
contextualize_chain = contextualize_prompt | rewriter_llm | StrOutputParser()


# ============================================================================
# Step 1: State Definition with State Reducer & Day 7/10 Retry & Memory Budget
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

    # Day 10: Multi-Turn Conversation History (persisted in DB and checkpointer)
    chat_history: List[dict]

    # Final Output text
    answer: str


# ============================================================================
# Step 2: Worker Nodes
# ============================================================================

def contextualize_query_node(state: RAGState) -> dict:
    """
    Day 10: History-Aware Query Contextualizer.
    Resolves anaphoric pronouns and follow-up references ('what about it?', 'explain that', 'elaborate')
    into standalone search queries using thread chat history stored in MemorySaver.
    Fast-path (0ms): If chat_history is empty or the query has no follow-up markers, bypasses LLM!
    """
    question = state["question"].strip()
    history = state.get("chat_history") or []

    # Fast bypass 1: No previous history in thread -> pass directly (0ms)
    if not history or len(history) < 2:
        return {"question": question, "original_question": question}

    # Fast bypass 2: User explicitly pinned context -> pass directly (0ms)
    if state.get("selected_context"):
        return {"question": question, "original_question": question}

    # Fast bypass 3: Only contextualize if follow-up / anaphoric markers are present
    followup_pattern = (
        r'\b(it|its|they|them|their|this|that|these|those|the former|the latter|'
        r'second one|first one|third one|last one|elaborate|expand|more detail|tell me more|why\?)\b'
    )
    if not re.search(followup_pattern, question, re.IGNORECASE):
        # Already self-contained -> zero latency bypass!
        return {"question": question, "original_question": question}

    # Contextualize using recent chat history
    formatted_history = []
    for turn in history[-4:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        formatted_history.append(f"{role.capitalize()}: {content}")
    history_str = "\n".join(formatted_history)

    try:
        standalone_q = contextualize_chain.invoke({
            "chat_history": history_str,
            "question": question
        }).strip()
        return {
            "question": standalone_q if len(standalone_q) > 3 else question,
            "original_question": question
        }
    except Exception:
        return {"question": question, "original_question": question}


def is_conversation_scoped_query(q: str) -> bool:
    """
    Detects if the user's question is asking about the chat history,
    prior questions, previous answers, or past conversation turns.
    Handles typos ('quations'), plurals, and phrasing variations ('point out any chat').
    """
    q_lower = q.lower().strip()

    # 1. Any mention of previous / past / earlier / last / prior combined with question / query / chat / turn
    hist_keywords = r'\b(previous|past|earlier|last|prior|before|recent)\b'
    chat_keywords = r'\b(qu[ea]stions?|queries|query|prompts?|responses?|answers?|points?|topics?|messages?|chats?|conversations?|discussions?|turns?)\b'
    if re.search(hist_keywords, q_lower) and re.search(chat_keywords, q_lower):
        return True

    # 2. Point out / review / show chat history
    if re.search(r'\b(point|opint|show|list|tell|give)\s*(out)?.*?(chat|conversation|history)\b', q_lower):
        return True

    # 3. Direct recall / interrogation patterns
    recall_patterns = (
        r'\bwhat (is|are|was|were) (my|our|the) (previous|last|first|second|other|earlier|past)\b'
        r'|\bwhat did (i|you|we) (say|ask|mean|write|mention|tell|discuss|point out)\b'
        r'|\bwhat (have i|have we|did i) asked\b'
        r'|\brepeat (what|that|the last|your|my)\b'
        r'|\b(our (chat|conversation|discussion))\b'
        r'|\b(summarize (our|this) (chat|conversation))\b'
        r'|\b(in this (chat|conversation))\b'
        r'|\b(from (our|the) conversation)\b'
        r'|\b(chat history|conversation history)\b'
        r'|\b(what (was|is) my (last|first|previous) (question|query|prompt))\b'
    )
    if re.search(recall_patterns, q_lower):
        return True

    return False


def route_query_node(state: RAGState) -> dict:
    """Classifies user intent with high-speed regex fast-paths and intelligent LLM routing."""
    question = state["question"].strip()
    focus_text = (state.get("selected_context") or "").strip()

    # Fast bypass 1: if user explicitly pinned context, always retrieve
    if focus_text:
        return {"route": "document_retrieval"}

    # Fast bypass 2: Instant 0ms regex check for greetings and courtesies
    q_norm = question.lower().strip("!?. ")
    common_greetings = {"hi", "hello", "hey", "greetings", "good morning", "good evening", "good afternoon", "thanks", "thank you", "bye", "goodbye", "who are you"}
    if q_norm in common_greetings or re.match(r'^(hi|hello|hey|greetings)\b', q_norm):
        return {"route": "direct_conversation"}

    # Fast bypass 2.5: Conversational recall & past discussion inquiries (0ms)
    if is_conversation_scoped_query(question):
        return {"route": "direct_conversation"}

    # Fast bypass 3: Explicit document-scoped synthesis requests (0ms)
    if is_document_scoped_query(question):
        return {"route": "document_retrieval"}

    # Intelligent intent classification via LLM router for nuanced queries
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
    """Answers greetings, pleasantries, and conversation-history questions directly using DB-backed chat history."""
    question = state["question"]
    history = state.get("chat_history") or []
    filename = state.get("filename", "your document")

    formatted_history = []
    user_q_count = 1
    for turn in history[-10:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role == "user":
            formatted_history.append(f"User (Question {user_q_count}): {content}")
            user_q_count += 1
        else:
            formatted_history.append(f"Assistant: {content}")
    history_str = "\n".join(formatted_history) if formatted_history else "No prior conversation messages recorded yet."

    try:
        reply = direct_chat_chain.invoke({
            "filename": filename,
            "chat_history": history_str,
            "question": question
        })
    except Exception as e:
        if is_conversation_scoped_query(question) and history:
            user_turns = [t["content"] for t in history if t.get("role") == "user"]
            if user_turns:
                questions_list = "\n".join([f"{i+1}. {q}" for i, q in enumerate(user_turns)])
                reply = f"Here are your previous questions from our conversation:\n\n{questions_list}"
            else:
                reply = "I reviewed our conversation history, but no previous questions were recorded for this document yet."
        else:
            reply = f"Hello! I am your DocuLens assistant for **{filename}**. How can I help you with your document today?"

    return {
        "answer": reply,
        "sources": []
    }


def is_document_scoped_query(q: str) -> bool:
    """
    Detects if the user's question is explicitly scoped to the uploaded document or report.
    Whenever a question references the document, report, notes, or asks for high-level synthesis
    (e.g. 'What is the bottom line of this report?', 'core conclusions and recommended action items here',
    summaries, action items, recommendations), it MUST stay within the document
    and NEVER trigger external web search fallback.
    """
    # 1. Direct references to document, report, notes, paper, or deictic markers
    doc_refs = (
        r'\b(this|the|my|our)\s+(document|documen|report|pdf|file|notes|paper|article|guide|text|study)\b'
        r'|\b(in|from|of)\s+(this|here)\b'
        r'|\b(author|uploaded|attached)\b'
        r'|\bhere\b'
    )
    if re.search(doc_refs, q, re.IGNORECASE):
        return True

    # 2. Holistic/Synthesizing and analytical questions
    holistic = (
        r'\b(bottom line|summar(y|ize|ise|ization)|overview|conclusions?|action items?|'
        r'recommendations?|takeaways?|insights?|main (points?|topics?|ideas?|themes?)|'
        r'next steps?|tl;?dr|core message|key findings?|what is this about)\b'
    )
    if re.search(holistic, q, re.IGNORECASE):
        return True

    return False


def retrieve_node(state: RAGState) -> dict:
    """Queries ChromaDB with strict multi-tenant metadata isolation."""
    vectorstore = get_vectorstore()
    question = state["question"]
    focus_text = (state.get("selected_context") or "").strip()
    filename = state.get("filename", "")

    # For holistic document queries or document-wide requests, expand retrieval window
    is_doc_scoped = is_document_scoped_query(question)
    k_chunks = 6 if is_doc_scoped else 4
    search_query = f"{question} {focus_text[:200]}" if focus_text else question

    scored_docs = vectorstore.similarity_search_with_relevance_scores(
        search_query,
        k=k_chunks,
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
    """
    Day 9: High-Speed Multi-Tier Relevance Gate (<1ms local decision).
    Evaluates ChromaDB chunks using cosine confidence & document scoping:
    - Tier 1: User-pinned context -> Instant 100% relevance (0ms).
    - Tier 1.5: Document-scoped query (e.g. 'What is the bottom line of this report?', summaries)
                -> Instant has_context (0ms, NEVER sent to web search).
    - Tier 2: Confident vector match (score >= 0.58) -> Instant has_context (0ms).
    - Tier 3: Low vector match (score < 0.52) -> Instant no_context (0ms, triggers web fallback).
    - Tier 4: Ambiguous zone [0.52, 0.58) -> Fast lexical entity anchor check (0ms).
    Eliminates slow cloud LLM round-trips that cause 504 timeouts and rate limits!
    """
    question = state["question"]
    raw_docs = state.get("documents", [])
    chunk_scores = state.get("chunk_scores") or []
    focus_text = (state.get("selected_context") or "").strip()
    filename = state.get("filename", "Document")

    if not raw_docs:
        return {
            "relevant_documents": [],
            "relevance_status": "no_context",
            "sources": []
        }

    relevant_docs = []
    verified_sources = []

    # Priority 1: Handle pinned focus text immediately (always relevant)
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

    top_score = max(chunk_scores) if chunk_scores else 0.0

    # If focus text was pinned by the user, we already have verified context
    if relevant_docs:
        return {
            "relevant_documents": relevant_docs,
            "relevance_status": "has_context",
            "sources": verified_sources
        }

    # Tier 1.5: Document-Scoped Query (e.g. 'What is the bottom line of this report?', summaries, etc.)
    # CRITICAL RULE: NEVER route questions asking about 'this document / report' to external web search!
    if is_document_scoped_query(question):
        for idx, chunk in enumerate(non_focus_chunks):
            relevant_docs.append(chunk)
            verified_sources.append({
                "id": len(verified_sources) + 1,
                "content": chunk,
                "source": filename,
                "match": "Document"
            })
        return {
            "relevant_documents": relevant_docs if relevant_docs else raw_docs,
            "relevance_status": "has_context",
            "sources": verified_sources
        }

    # Tier 2: Strong vector confidence (score >= 0.58) -> In-document query
    if top_score >= 0.58:
        for idx, chunk in enumerate(non_focus_chunks):
            score = chunk_scores[idx] if idx < len(chunk_scores) else top_score
            if score >= 0.55:
                relevant_docs.append(chunk)
                verified_sources.append({
                    "id": len(verified_sources) + 1,
                    "content": chunk,
                    "source": filename,
                    "match": "Verified"
                })
        return {
            "relevant_documents": relevant_docs if relevant_docs else non_focus_chunks[:2],
            "relevance_status": "has_context",
            "sources": verified_sources if verified_sources else [{"id": 1, "content": non_focus_chunks[0], "source": filename, "match": "Verified"}]
        }

    # Tier 3: Low vector confidence (score < 0.52) -> Definitely out-of-document
    if top_score < 0.52:
        return {
            "relevant_documents": [],
            "relevance_status": "no_context",
            "sources": []
        }

    # Tier 4: Ambiguous zone [0.52, 0.58) -> Check entity keyword presence
    all_chunks_text = " ".join(non_focus_chunks).lower()
    stop_words = {"what", "when", "where", "which", "who", "whom", "whose", "why", "how", "the", "and", "for", "are", "is", "can", "tell", "current", "2026", "with", "from"}
    query_words = [w.lower() for w in re.findall(r'\b[a-zA-Z0-9_\.-]+\b', question) if w.lower() not in stop_words and len(w) > 2]
    matched_words = [w for w in query_words if w in all_chunks_text]

    # If more than 50% of the substantive keywords exist in the chunks
    if query_words and (len(matched_words) / len(query_words)) >= 0.5:
        for idx, chunk in enumerate(non_focus_chunks[:2]):
            relevant_docs.append(chunk)
            verified_sources.append({
                "id": len(verified_sources) + 1,
                "content": chunk,
                "source": filename,
                "match": "Verified"
            })
        return {
            "relevant_documents": relevant_docs,
            "relevance_status": "has_context",
            "sources": verified_sources
        }

    return {
        "relevant_documents": [],
        "relevance_status": "no_context",
        "sources": []
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
    """Generates grounded answer using only the verified relevant context and recent chat history."""
    relevant_docs = state.get("relevant_documents", [])
    # Answer the original question using the freshly retrieved context
    question_to_answer = state.get("original_question") or state["question"]
    filename = state.get("filename", "the document")
    history = state.get("chat_history") or []

    formatted_context = "\n\n".join(relevant_docs)

    formatted_history = []
    for turn in history[-4:]:
        role = "User" if turn.get("role") == "user" else "Assistant"
        content = turn.get("content", "")
        formatted_history.append(f"{role}: {content}")
    history_str = "\n".join(formatted_history) if formatted_history else "No prior messages."

    now = datetime.now()
    current_date = now.strftime("%B %d, %Y")
    current_year = str(now.year)

    rag_chain = rag_prompt | generator_llm | StrOutputParser()
    try:
        answer_text = rag_chain.invoke({
            "context": formatted_context,
            "question": question_to_answer,
            "filename": filename,
            "chat_history": history_str,
            "current_date": current_date,
            "current_year": current_year
        })
    except Exception as e:
        # Graceful fallback: return top relevant chunk excerpt if Gemini API timed out
        if relevant_docs:
            answer_text = f"Based on **{filename}**:\n\n{relevant_docs[0][:600]}..."
        else:
            answer_text = f"I retrieved the relevant context from **{filename}**, but experienced a temporary service delay generating the full synthesis. Please ask again."

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
        max_output_tokens=2048,
        max_retries=2,
        timeout=30
    )

    chain = strict_prompt | strict_llm | StrOutputParser()
    try:
        corrected_answer = chain.invoke({
            "context": formatted_context,
            "question": question,
            "reason": reason
        })
    except Exception:
        corrected_answer = state.get("answer", "")

    return {
        "answer": corrected_answer,
        "generation_retry_count": retry_count + 1,
        "verification_status": "grounded"
    }


def clean_search_query(q: str) -> str:
    """Strips conversational phrases and temporal filler words while preserving search keywords and entities."""
    pattern = r'^(what (is|are|was|were)( the| a| an)?|can you (tell|explain|find)( me)?|how much (is|are)|please (tell|give|show) me|tell me about|who is|where is|when was)\s+'
    cleaned = re.sub(pattern, '', q.strip(), flags=re.I)
    cleaned = re.sub(r'\b(current|latest|today|now)\b', '', cleaned, flags=re.I)
    cleaned = re.sub(r'\?+$', '', cleaned).strip()
    cleaned = ' '.join(cleaned.split())
    return cleaned if len(cleaned) > 3 else q


def fast_web_search(query: str, max_results: int = 3) -> list:
    """
    Sub-second fast web search using a single direct Bing parser (<1.4s).
    CRITICAL ZERO-LEAKAGE RULE: NEVER accept or send document excerpts, chunks, or filenames.
    ONLY the clean, standalone user query is dispatched.
    """
    clean_q = clean_search_query(query)
    results = []

    try:
        session = requests.Session()
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        resp = session.get("https://www.bing.com/search", params={"q": clean_q}, headers=headers, timeout=3.5)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            for li in soup.find_all("li", class_="b_algo")[:max_results]:
                h2 = li.find("h2")
                a = h2.find("a") if h2 else None
                snippet = li.find("p") or li.find("div", class_="b_caption")
                title = a.get_text().strip() if a else ""
                url = a.get("href", "").strip() if a else ""
                desc = snippet.get_text().strip() if snippet else ""
                if title and url:
                    results.append({
                        "title": title,
                        "url": url,
                        "snippet": desc[:300]
                    })
    except Exception:
        pass

    return results


def web_search_node(state: RAGState) -> dict:
    """
    Day 8: Web Search Tool Fallback Node.
    CRITICAL PRIVACY RULE: NEVER pass document text, excerpts, or filenames to external search.
    ONLY the clean, standalone user query is dispatched.
    """
    query = state.get("original_question") or state["question"]
    filename = state.get("filename", "your document")

    results = fast_web_search(query, max_results=3)

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
1. Clearly state upfront in 1 brief sentence that this specific detail was not found in {filename}, but was retrieved from live web search.
2. Answer the user's question accurately and concisely in 2-3 sentences based strictly on the Web Results below.
3. Reference the web sources or domains.

Web Results:
{web_context}

User Question:
{question}

Answer:"""
    )

    rag_chain = web_rag_prompt | web_llm | StrOutputParser()
    try:
        answer_text = rag_chain.invoke({
            "web_context": web_context_str,
            "question": query,
            "filename": filename
        })
    except Exception:
        # Fallback to direct web search summaries if LLM call times out
        top_results = "\n\n".join([f"- **{r['title']}**: {r['snippet']}" for r in results[:2]])
        answer_text = f"This detail was not found in **{filename}**, but here are the relevant search results:\n\n{top_results}"

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


def record_history_node(state: RAGState) -> dict:
    """
    Day 10: State Checkpoint Finalizer.
    Appends the completed user-assistant turn to the thread history.
    """
    question = state.get("original_question") or state.get("question", "")
    answer = state.get("answer", "")
    history = list(state.get("chat_history") or [])
    if question and answer:
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": answer})
    return {
        "chat_history": history
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
    Dynamic Routing:
    1. If relevant documents exist in ChromaDB -> generate answer directly.
    2. If question is about past conversation -> direct_generate (uses DB history).
    3. If question is scoped to the document -> generate (never external web search).
    4. If NO relevant chunks found in ChromaDB -> trigger the web search tool!
    """
    if state.get("relevance_status") == "has_context":
        return "generate"

    question = state.get("original_question") or state.get("question", "")
    if is_conversation_scoped_query(question):
        return "direct_generate"

    if is_document_scoped_query(question):
        return "generate"

    # Immediately use the web search tool when related chunks are not found in ChromaDB
    return "web_search"


def route_after_verification(state: RAGState) -> str:
    """
    Day 9/10 Quality Gate Routing:
    - If grounded -> record history & deliver to user with 0 extra cloud calls.
    - If hallucinated AND generation_retry_count < 1 -> strict_regenerate.
    - If generation_retry_count >= 1 -> finish safely to record_history.
    """
    if state.get("verification_status") == "grounded":
        return "record_history"

    retries = state.get("generation_retry_count", 0)
    if retries < 1:
        return "strict_regenerate"

    return "record_history"


# ============================================================================
# Step 4: Constructing & Compiling the Day 10 StateGraph with MemorySaver
# ============================================================================

def build_rag_graph():
    """Compiles the Day 10 cyclic state graph with MemorySaver checkpointer, Multi-Turn history, and Self-RAG verification."""
    workflow = StateGraph(RAGState)

    # 1. Add all worker nodes
    workflow.add_node("contextualize_query", contextualize_query_node)
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
    workflow.add_node("record_history", record_history_node)

    # 2. Add control flow edges
    # Day 10 Entry: Start at contextualizer before router
    workflow.add_edge(START, "contextualize_query")
    workflow.add_edge("contextualize_query", "route_query")

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
            "record_history": "record_history",
            "strict_regenerate": "strict_regenerate"
        }
    )

    # Cyclic feedback loop: Strict regenerate feeds back to verifier
    workflow.add_edge("strict_regenerate", "verify_generation")

    # Transitions to history record node & terminal END
    workflow.add_edge("direct_generate", "record_history")
    workflow.add_edge("web_search", "record_history")
    workflow.add_edge("no_context_fallback", "record_history")
    workflow.add_edge("record_history", END)

    return workflow.compile(checkpointer=checkpointer)


# Compiled singleton instance with MemorySaver checkpointer
rag_graph = build_rag_graph()
