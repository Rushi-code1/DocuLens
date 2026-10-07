from django.http import FileResponse
from rest_framework import generics, status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.shortcuts import get_object_or_404

from .models import Document, ChatMessage
from .serializers import (
    UserSerializer,
    RegisterSerializer,
    DocumentSerializer,
    ChatMessageSerializer
)
from .rag_service import process_document, query_document
from .graph_rag import rag_graph


class RegisterView(generics.CreateAPIView):
    permission_classes = (permissions.AllowAny,)
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response({
            "user": UserSerializer(user).data,
            "tokens": {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            }
        }, status=status.HTTP_201_CREATED)


class CurrentUserView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


class DocumentListView(generics.ListAPIView):
    permission_classes = (permissions.IsAuthenticated,)
    serializer_class = DocumentSerializer

    def get_queryset(self):
        return Document.objects.filter(user=self.request.user)


class DocumentUploadView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({"detail": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Read file bytes
        file_bytes = uploaded_file.read()

        # 2. Save Document instance
        doc = Document(
            user=request.user,
            file=uploaded_file,
            filename=uploaded_file.name
        )
        doc.save()

        # 3. Process with RAG & extract Day 3 structured summary
        try:
            summary = process_document(doc, file_bytes)
        except Exception as e:
            return Response({"detail": f"Failed to process document: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        serializer = DocumentSerializer(doc, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class DocumentDetailView(generics.RetrieveDestroyAPIView):
    permission_classes = (permissions.IsAuthenticated,)
    serializer_class = DocumentSerializer

    def get_queryset(self):
        return Document.objects.filter(user=self.request.user)


class DocumentMessagesView(generics.ListAPIView):
    permission_classes = (permissions.IsAuthenticated,)
    serializer_class = ChatMessageSerializer

    def get_queryset(self):
        doc_id = self.kwargs.get('doc_id')
        document = get_object_or_404(Document, id=doc_id, user=self.request.user)
        return document.chat_messages.all()


class DocumentAskView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, doc_id):
        document = get_object_or_404(Document, id=doc_id, user=request.user)
        question = request.data.get('question', '').strip()
        selected_context = request.data.get('selected_context', '').strip()

        if not question:
            return Response({"detail": "Question cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Save User Chat Message
        user_msg = ChatMessage.objects.create(
            document=document,
            user=request.user,
            sender='user',
            content=question,
            selected_context=selected_context
        )

        # 2. Retrieve recent persistent conversation history from the database (up to last 8 turns)
        prev_messages = ChatMessage.objects.filter(
            document=document,
            user=request.user
        ).exclude(id=user_msg.id).order_by('-created_at')[:8]

        db_history = [
            {"role": m.sender, "content": m.content}
            for m in reversed(prev_messages)
        ]

        # 3. Execute Day 10 LangGraph State Workflow (Checkpointer + DB-Backed Multi-Turn Memory + Self-RAG)
        try:
            thread_id = f"user_{request.user.id}_doc_{document.id}"
            config = {"configurable": {"thread_id": thread_id}}
            initial_state = {
                "user_id": request.user.id,
                "document_id": document.id,
                "filename": document.filename,
                "question": question,
                "original_question": question,
                "selected_context": selected_context,
                "retry_count": 0,
                "generation_retry_count": 0,
                "sources": [],
                "chat_history": db_history,
            }
            graph_output = rag_graph.invoke(initial_state, config=config)
            answer_text = graph_output.get("answer", "")
            sources = graph_output.get("sources", [])
        except Exception as e:
            err_str = str(e)
            if "DEADLINE_EXCEEDED" in err_str or "timeout" in err_str.lower():
                answer_text = (
                    "⚠️ The AI service took longer than expected to process this request (temporary network timeout). "
                    "Please try submitting your question again."
                )
            else:
                answer_text = f"⚠️ I encountered an issue processing your request: {err_str}"
            sources = []

        # 3. Save Assistant Chat Message
        bot_msg = ChatMessage.objects.create(
            document=document,
            user=request.user,
            sender='assistant',
            content=answer_text
        )

        return Response({
            "answer": answer_text,
            "sources": sources,
            "user_message": ChatMessageSerializer(user_msg).data,
            "assistant_message": ChatMessageSerializer(bot_msg).data
        })


class DocumentDownloadView(APIView):
    """High-speed binary stream endpoint with JWT authentication."""
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request, doc_id):
        doc = get_object_or_404(Document, id=doc_id, user=request.user)
        if not doc.file:
            return Response({"detail": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(doc.file.open('rb'), content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{doc.filename}"'
        return response
