import os
from databases import Database
from datetime import datetime
import uuid
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Get database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL")

# Create database instance
database = Database(DATABASE_URL) if DATABASE_URL else None

# Default user ID for now (single user)
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"

# ============================================
# DATABASE LIFECYCLE
# ============================================

async def connect_db():
    """Connect to database"""
    if database and DATABASE_URL:
        try:
            await database.connect()
            print("✅ Database connected")
        except Exception as e:
            print(f"⚠️  Database connection failed: {e}")
    else:
        print("⚠️  DATABASE_URL not found - conversations will not be saved")

async def disconnect_db():
    """Disconnect from database"""
    if database and database.is_connected:
        await database.disconnect()
        print("Database disconnected")

# ============================================
# CONVERSATION MANAGEMENT
# ============================================

async def create_conversation(article_url: str, article_title: str) -> str:
    """Create a new conversation and return its ID"""
    if not database:
        return None
        
    try:
        conversation_id = str(uuid.uuid4())
        
        query = """
        INSERT INTO conversations (id, user_id, article_url, article_title, started_at, message_count)
        VALUES (:id, :user_id, :url, :title, :started_at, 0)
        RETURNING id
        """
        
        result = await database.fetch_one(
            query=query,
            values={
                "id": conversation_id,
                "user_id": DEFAULT_USER_ID,
                "url": article_url,
                "title": article_title,
                "started_at": datetime.now()
            }
        )
        
        print(f"✅ Created conversation: {conversation_id}")
        return conversation_id
    except Exception as e:
        print(f"Error creating conversation: {e}")
        return None

async def save_message(
    conversation_id: str,
    role: str,
    content: str,
    input_method: str = "text"
):
    """Save a message to the database"""
    if not database or not conversation_id:
        return
        
    try:
        query = """
        INSERT INTO messages (id, conversation_id, role, content, input_method, created_at)
        VALUES (:id, :conversation_id, :role, :content, :input_method, :created_at)
        """
        
        await database.execute(
            query=query,
            values={
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "role": role,
                "content": content,
                "input_method": input_method,
                "created_at": datetime.now()
            }
        )
        
        # Update message count
        await database.execute(
            query="UPDATE conversations SET message_count = message_count + 1 WHERE id = :id",
            values={"id": conversation_id}
        )
        
        print(f"✅ Saved {role} message to conversation {conversation_id}")
    except Exception as e:
        print(f"Error saving message: {e}")

async def get_conversations(limit: int = 50):
    """Get recent conversations"""
    if not database:
        return []
        
    try:
        query = """
        SELECT 
            c.id,
            c.article_url,
            c.article_title,
            c.started_at,
            c.message_count,
            (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_question
        FROM conversations c
        WHERE c.user_id = :user_id
        ORDER BY c.started_at DESC
        LIMIT :limit
        """
        
        results = await database.fetch_all(
            query=query,
            values={"user_id": DEFAULT_USER_ID, "limit": limit}
        )
        
        return [dict(row) for row in results]
    except Exception as e:
        print(f"Error fetching conversations: {e}")
        return []

async def get_conversation_messages(conversation_id: str):
    """Get all messages in a conversation"""
    if not database:
        return []
        
    try:
        query = """
        SELECT 
            id,
            role,
            content,
            input_method,
            created_at
        FROM messages
        WHERE conversation_id = :conversation_id
        ORDER BY created_at ASC
        """
        
        results = await database.fetch_all(
            query=query,
            values={"conversation_id": conversation_id}
        )
        
        return [dict(row) for row in results]
    except Exception as e:
        print(f"Error fetching messages: {e}")
        return []

async def search_conversations(query_text: str, limit: int = 10):
    """Search conversations by content"""
    if not database:
        return []
        
    try:
        query = """
        SELECT DISTINCT
            c.id,
            c.article_url,
            c.article_title,
            c.started_at,
            c.message_count
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE 
            c.user_id = :user_id
            AND (
                m.content ILIKE :search
                OR c.article_title ILIKE :search
            )
        ORDER BY c.started_at DESC
        LIMIT :limit
        """
        
        search_pattern = f"%{query_text}%"
        results = await database.fetch_all(
            query=query,
            values={
                "user_id": DEFAULT_USER_ID,
                "search": search_pattern,
                "limit": limit
            }
        )
        
        return [dict(row) for row in results]
    except Exception as e:
        print(f"Error searching conversations: {e}")
        return []

async def delete_conversation(conversation_id: str):
    """Delete a conversation and all its messages"""
    if not database:
        return False
        
    try:
        # Messages will be auto-deleted due to CASCADE
        await database.execute(
            query="DELETE FROM conversations WHERE id = :id",
            values={"id": conversation_id}
        )
        print(f"✅ Deleted conversation: {conversation_id}")
        return True
    except Exception as e:
        print(f"Error deleting conversation: {e}")
        return False

async def get_conversation_stats():
    """Get statistics about conversations"""
    if not database:
        return {}
        
    try:
        query = """
        SELECT 
            COUNT(*) as total_conversations,
            SUM(message_count) as total_messages,
            AVG(message_count) as avg_messages_per_conversation
        FROM conversations
        WHERE user_id = :user_id
        """
        
        result = await database.fetch_one(
            query=query,
            values={"user_id": DEFAULT_USER_ID}
        )
        
        return dict(result) if result else {}
    except Exception as e:
        print(f"Error fetching stats: {e}")
        return {}