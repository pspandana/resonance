from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
import hashlib
from datetime import datetime
from typing import Optional, List

# Import database functions
from database import (
    connect_db, disconnect_db,
    create_conversation, save_message,
    get_conversations, get_conversation_messages,
    search_conversations, delete_conversation,
    get_conversation_stats
)

load_dotenv()

app = FastAPI(title="Resonance API", version="0.3.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI
openai.api_key = os.getenv("OPENAI_API_KEY")

# Initialize Pinecone
pc = None
index = None

try:
    PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
    if PINECONE_API_KEY:
        pc = Pinecone(api_key=PINECONE_API_KEY)
        
        index_name = "resonance-articles"
        
        if index_name not in pc.list_indexes().names():
            print(f"Creating Pinecone index: {index_name}")
            pc.create_index(
                name=index_name,
                dimension=1536,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-east-1")
            )
        
        index = pc.Index(index_name)
        print("✅ Pinecone connected successfully")
    else:
        print("⚠️  Pinecone API key not found - RAG features disabled")
except Exception as e:
    print(f"⚠️  Pinecone initialization failed: {e}")

# Startup/Shutdown events
@app.on_event("startup")
async def startup():
    """Connect to database on startup"""
    await connect_db()

@app.on_event("shutdown")
async def shutdown():
    """Disconnect from database on shutdown"""
    await disconnect_db()

# Data Models
class SummaryRequest(BaseModel):
    title: str
    content: str
    url: str
    type: str = "summary"
    conversation_id: Optional[str] = None

class QuestionRequest(BaseModel):
    question: str
    title: str
    content: str
    url: str
    conversation_id: Optional[str] = None

class ConversationResponse(BaseModel):
    id: str
    article_title: str
    article_url: str
    started_at: datetime
    message_count: int
    first_question: Optional[str] = None

# Helper Functions
def generate_article_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()

def get_embedding(text: str) -> list:
    try:
        response = openai.embeddings.create(
            model="text-embedding-ada-002",
            input=text[:8000]
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Embedding error: {e}")
        return None

def store_article_in_rag(article_id: str, title: str, url: str, content: str, summary: str):
    if not index:
        return False
    
    try:
        text_to_embed = f"{title}\n\n{summary}"
        embedding = get_embedding(text_to_embed)
        
        if not embedding:
            return False
        
        index.upsert(vectors=[{
            "id": article_id,
            "values": embedding,
            "metadata": {
                "title": title,
                "url": url,
                "summary": summary[:1000],
                "timestamp": datetime.now().isoformat(),
                "content_preview": content[:500]
            }
        }])
        print(f"✅ Stored article in RAG: {title}")
        return True
    except Exception as e:
        print(f"Error storing in RAG: {e}")
        return False

def retrieve_similar_articles(query: str, top_k: int = 3):
    if not index:
        return []
    
    try:
        query_embedding = get_embedding(query)
        if not query_embedding:
            return []
        
        results = index.query(
            vector=query_embedding,
            top_k=top_k,
            include_metadata=True
        )
        
        similar_articles = []
        for match in results.matches:
            if match.score > 0.7:
                similar_articles.append({
                    "title": match.metadata.get("title", "Unknown"),
                    "summary": match.metadata.get("summary", ""),
                    "url": match.metadata.get("url", ""),
                    "similarity": match.score
                })
        
        return similar_articles
    except Exception as e:
        print(f"Error retrieving similar articles: {e}")
        return []

# API Endpoints
@app.get("/")
async def root():
    rag_status = "enabled" if index else "disabled"
    return {
        "message": "Resonance API is running",
        "version": "0.3.0",
        "status": "healthy",
        "rag": rag_status,
        "history": "enabled"
    }

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/api/summarize")
async def summarize(request: SummaryRequest):
    """Summarize an article with RAG context and save to history"""
    try:
        article_id = generate_article_id(request.url)
        
        # Get or create conversation
        conversation_id = request.conversation_id
        if not conversation_id:
            conversation_id = await create_conversation(request.url, request.title)
        
        # Retrieve similar articles
        similar_articles = retrieve_similar_articles(request.title)
        
        # Build context
        context = ""
        if similar_articles:
            context = "\n\nContext - You've previously read:\n"
            for i, article in enumerate(similar_articles, 1):
                context += f"{i}. \"{article['title']}\" - {article['summary'][:200]}...\n"
        
        # Format prompt
        if request.type == "key-points":
            system_prompt = "Extract key points as a bulleted list. Use format:\n• Point one\n• Point two"
            user_prompt = f"Extract 5-7 key points:\n\nTitle: {request.title}\n\n{request.content[:4000]}"
        else:
            system_prompt = "You are a helpful reading assistant. Provide clear, concise summaries."
            if similar_articles:
                system_prompt += " When the user has read related articles, point out what's NEW or DIFFERENT."
            user_prompt = f"{context}\n\nSummarize this article in 2-3 paragraphs:\n\nTitle: {request.title}\n\n{request.content[:4000]}"
        
        # Save user request
        if conversation_id and request.type == "summary":
            await save_message(conversation_id, "user", "Summarize this article", "button")
        elif conversation_id:
            await save_message(conversation_id, "user", "Give me key points", "button")
        
        # Call OpenAI
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=400,
            temperature=0.7
        )
        
        summary = response.choices[0].message.content
        
        # Save assistant response
        if conversation_id:
            await save_message(conversation_id, "assistant", summary, "button")
        
        # Store in RAG
        if request.type == "summary":
            store_article_in_rag(article_id, request.title, request.url, request.content, summary)
        
        return {
            "success": True,
            "summary": summary,
            "article_title": request.title,
            "type": request.type,
            "related_articles": len(similar_articles),
            "conversation_id": conversation_id
        }
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/question")
async def answer_question(request: QuestionRequest):
    """Answer question with RAG context and save to history"""
    try:
        # Get or create conversation
        conversation_id = request.conversation_id
        if not conversation_id:
            conversation_id = await create_conversation(request.url, request.title)
        
        # Save user question
        if conversation_id:
            await save_message(conversation_id, "user", request.question, "text")
        
        # Retrieve similar articles
        similar_articles = retrieve_similar_articles(request.question)
        
        # Build context
        context = ""
        if similar_articles:
            context = "\n\nAdditional context from reading history:\n"
            for article in similar_articles:
                context += f"- You previously read \"{article['title']}\": {article['summary'][:150]}...\n"
        
        # Build prompt
        system_prompt = "You are a helpful reading assistant. Answer accurately and concisely."
        user_prompt = f"""
Based on this article:

Title: {request.title}
Content: {request.content[:4000]}

{context}

Question: {request.question}

Provide a clear answer. If the question relates to previous reading (shown in context), mention the connection.
"""
        
        # Call OpenAI
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=300,
            temperature=0.7
        )
        
        answer = response.choices[0].message.content
        
        # Save assistant answer
        if conversation_id:
            await save_message(conversation_id, "assistant", answer, "text")
        
        return {
            "success": True,
            "answer": answer,
            "question": request.question,
            "related_articles": len(similar_articles),
            "conversation_id": conversation_id
        }
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Conversation History Endpoints
@app.get("/api/conversations")
async def list_conversations(limit: int = 50):
    """Get recent conversations"""
    try:
        conversations = await get_conversations(limit)
        return {
            "success": True,
            "conversations": conversations,
            "count": len(conversations)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all messages"""
    try:
        messages = await get_conversation_messages(conversation_id)
        return {
            "success": True,
            "conversation_id": conversation_id,
            "messages": messages,
            "message_count": len(messages)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/conversations/search/{query}")
async def search_convos(query: str, limit: int = 10):
    """Search conversations"""
    try:
        results = await search_conversations(query, limit)
        return {
            "success": True,
            "results": results,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/conversations/{conversation_id}")
async def remove_conversation(conversation_id: str):
    """Delete a conversation"""
    try:
        success = await delete_conversation(conversation_id)
        return {
            "success": success,
            "message": "Conversation deleted" if success else "Failed to delete"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
async def get_stats():
    """Get reading and conversation statistics"""
    try:
        conversation_stats = await get_conversation_stats()
        
        rag_stats = {}
        if index:
            try:
                stats = index.describe_index_stats()
                rag_stats = {"total_articles": stats.total_vector_count}
            except:
                rag_stats = {"total_articles": 0}
        
        return {
            "rag_enabled": index is not None,
            "history_enabled": True,
            **rag_stats,
            **conversation_stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)