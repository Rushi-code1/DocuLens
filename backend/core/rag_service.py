import os
import io
import time
import logging
from datetime import datetime
from pathlib import Path
from pydantic import BaseModel, Field

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_chroma import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from django.conf import settings

logger = logging.getLogger(__name__)

CHROMA_DIR = str(settings.BASE_DIR / "chroma_db")

# Day 3: Pydantic Schema for Structured Document Insights
class DocumentSummary(BaseModel):
    title: str = Field(
        description="A concise, professional title or document name identified from the content"
    )
    executive_summary: str = Field(
        description="A 2-3 sentence high-level executive summary explaining what the document is about, its key objective, and primary conclusion or terms"
    )
    key_topics: list[str] = Field(
        description="3 to 4 core themes, topics, or key sections covered in the document"
    )
    suggested_questions: list[str] = Field(
        description="3 intelligent, specific questions that a reader would naturally ask about this specific document"
    )

summary_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an expert document analyst. "
        "CURRENT DATE: {current_date} (Year: {current_year}). "
        "The current real-world year is {current_year}. All temporal reasoning, timeline analysis, and date validations must be evaluated relative to this current date (dates up to and including {current_year} are valid past/present dates). "
        "Analyze the provided document text and generate an objective, concise, and high-value structured summary. "
        "Be specific and grounded strictly in the document content."
    ),
    (
        "human",
        "Document Name: {filename}\n\nDocument Text Excerpt:\n{text}"
    )
])

summary_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    temperature=0.2,
    max_output_tokens=2048
)

structured_summary_chain = summary_prompt | summary_llm.with_structured_output(DocumentSummary)


def clean_surrogates(text: str) -> str:
    """Filter out orphaned UTF-16 surrogates that break Chroma Rust bindings."""
    return "".join(c for c in text if not (0xD800 <= ord(c) <= 0xDFFF))


def extract_text_from_bytes(filename: str, content: bytes) -> str:
    """Extract clean raw text from PDF or plain text file bytes."""
    lower_name = filename.lower()
    if lower_name.endswith(".pdf"):
        import tempfile
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(content))
            extracted_pages = []
            for i, page in enumerate(reader.pages):
                page_text = page.extract_text() or ""
                extracted_pages.append(f"--- Page {i+1} ---\n{page_text}")
            return "\n\n".join(extracted_pages)
        except Exception:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                loader = PyPDFLoader(tmp_path)
                pages = loader.load()
                return "\n\n".join(page.page_content for page in pages)
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
    else:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="ignore")


def calculate_optimal_chunks(text: str):
    total_chars = len(text)
    if total_chars < 3000:
        return 600, 80
    elif total_chars < 15000:
        return 900, 120
    elif total_chars < 60000:
        return 1200, 150
    else:
        return 1500, 200


def get_vectorstore():
    embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")
    return Chroma(
        persist_directory=CHROMA_DIR,
        embedding_function=embeddings
    )


def safe_embed_and_index(documents, batch_size=6):
    vectorstore = get_vectorstore()
    for i in range(0, len(documents), batch_size):
        batch = documents[i:i + batch_size]
        for attempt in range(5):
            try:
                vectorstore.add_documents(batch)
                if i + batch_size < len(documents):
                    time.sleep(1.0)
                break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    time.sleep(3 * (attempt + 1))
                else:
                    raise e
    return vectorstore


def process_document(document_instance, content_bytes: bytes):
    """Parses text, chunks, embeds into Chroma with user/doc metadata, and generates Day 3 structured summary."""
    raw_text = extract_text_from_bytes(document_instance.filename, content_bytes)
    text = clean_surrogates(raw_text)

    chunk_size, chunk_overlap = calculate_optimal_chunks(text)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap
    )

    metadata = {
        "user_id": document_instance.user_id,
        "document_id": document_instance.id,
        "source": document_instance.filename
    }

    chunks = splitter.create_documents([text], metadatas=[metadata])
    for doc in chunks:
        doc.page_content = clean_surrogates(doc.page_content)

    safe_embed_and_index(chunks, batch_size=6)

    # Day 3: Generate Structured Summary via LCEL
    summary_data = None
    try:
        now = datetime.now()
        summary_result: DocumentSummary = structured_summary_chain.invoke({
            "filename": document_instance.filename,
            "text": text[:6000],
            "current_date": now.strftime("%B %d, %Y"),
            "current_year": str(now.year)
        })
        summary_data = summary_result.model_dump()
    except Exception as exc:
        logger.warning(f"Could not generate structured summary: {exc}")

    document_instance.full_text = text
    document_instance.word_count = len(text.split())
    document_instance.character_count = len(text)
    document_instance.summary = summary_data
    document_instance.save()

    return summary_data


def query_document(user, document_instance, question: str, selected_context: str = None):
    from .graph_rag import rag_graph

    thread_id = f"user_{user.id}_doc_{document_instance.id}"
    config = {"configurable": {"thread_id": thread_id}}
    initial_state = {
        "user_id": user.id,
        "document_id": document_instance.id,
        "filename": document_instance.filename,
        "question": question,
        "selected_context": selected_context,
        "documents": [],
        "sources": [],
        "answer": ""
    }
    # Execute graph with thread-scoped memory
    final_state = rag_graph.invoke(initial_state, config=config)
    return {
        "answer": final_state["answer"],
        "sources": final_state["sources"]
    }