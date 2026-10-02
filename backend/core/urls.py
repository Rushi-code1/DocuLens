from django.urls import path
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .views import (
    RegisterView,
    CurrentUserView,
    DocumentListView,
    DocumentUploadView,
    DocumentDetailView,
    DocumentMessagesView,
    DocumentAskView,
)

urlpatterns = [
    # Authentication & JWT
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/me/', CurrentUserView.as_view(), name='current_user'),

    # Document Management & RAG
    path('documents/', DocumentListView.as_view(), name='document_list'),
    path('documents/upload/', DocumentUploadView.as_view(), name='document_upload'),
    path('documents/<int:pk>/', DocumentDetailView.as_view(), name='document_detail'),
    path('documents/<int:doc_id>/messages/', DocumentMessagesView.as_view(), name='document_messages'),
    path('documents/<int:doc_id>/ask/', DocumentAskView.as_view(), name='document_ask'),
]
