from django.contrib import admin
from .models import Document, ChatMessage

@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('id', 'filename', 'user', 'word_count', 'created_at')
    search_fields = ('filename', 'user__username')
    list_filter = ('created_at',)

@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'document', 'user', 'sender', 'created_at')
    search_fields = ('content', 'user__username', 'document__filename')
    list_filter = ('sender', 'created_at')
