# How Resonance Works

**A Complete Technical Guide to Understanding Your AI Reading Assistant**

Version: 0.1.0  
Author: Built with understanding  
Last Updated: October 2025

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Deep Dive](#component-deep-dive)
4. [Data Flow: Step by Step](#data-flow-step-by-step)
5. [Key Technologies Explained](#key-technologies-explained)
6. [Code Walkthrough](#code-walkthrough)
7. [API Documentation](#api-documentation)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Interview Talking Points](#interview-talking-points)

---

## Overview

### What is Resonance?

Resonance is a Chrome extension that uses AI to summarize web articles. When you're reading an article online, you can click the extension icon to get an instant AI-generated summary.

### Core Functionality

- **Extract**: Automatically reads article content from any webpage
- **Summarize**: Sends content to AI (GPT-4o-mini) for intelligent summarization
- **Display**: Shows results in a clean, user-friendly popup interface

### Technology Stack

```
Frontend:  Chrome Extension (JavaScript, HTML, CSS)
Backend:   FastAPI (Python)
AI:        OpenAI GPT-4o-mini
Storage:   (Coming: PostgreSQL + Pinecone)
Hosting:   Local development (Production: Railway)
```

---

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER'S BROWSER                          │
│                                                             │
│  ┌───────────────────────────────────────────────────┐    │
│  │            WEBPAGE (Any Article)                  │    │
│  │  ┌─────────────────────────────────────────────┐  │    │
│  │  │  <html>                                     │  │    │
│  │  │    <article>                                │  │    │
│  │  │      <h1>Article Title</h1>                │  │    │
│  │  │      <p>Article content...</p>             │  │    │
│  │  │    </article>                               │  │    │
│  │  │  </html>                                    │  │    │
│  │  └─────────────────────────────────────────────┘  │    │
│  └───────────────────────────────────────────────────┘    │
│                           ▲                                 │
│                           │                                 │
│                    (1) Reads DOM                           │
│                           │                                 │
│  ┌────────────────────────┴──────────────────────────┐    │
│  │      CONTENT SCRIPT (content.js)                  │    │
│  │      • Injected into every webpage                │    │
│  │      • Can access page's HTML (DOM)               │    │
│  │      • Extracts article text from page            │    │
│  │      • Listens for messages from popup            │    │
│  └────────────────────────┬──────────────────────────┘    │
│                           │                                 │
│                    (2) Message Passing                     │
│                    chrome.runtime.sendMessage()            │
│                           │                                 │
│  ┌────────────────────────┴──────────────────────────┐    │
│  │        POPUP UI (popup.html/js/css)               │    │
│  │      • Opens when user clicks extension icon      │    │
│  │      • Displays article info (title, word count)  │    │
│  │      • Has "Summarize" and "Key Points" buttons   │    │
│  │      • Shows AI-generated responses               │    │
│  │      • Handles user interactions                  │    │
│  └────────────────────────┬──────────────────────────┘    │
│                           │                                 │
│  ┌────────────────────────┴──────────────────────────┐    │
│  │    BACKGROUND SCRIPT (background.js)              │    │
│  │      • Service worker (always running)            │    │
│  │      • Handles extension lifecycle events         │    │
│  │      • Currently minimal (future: caching, etc.)  │    │
│  └───────────────────────────────────────────────────┘    │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    (3) HTTP Request
                    fetch('http://localhost:8000/api/summarize')
                    POST with article data
                           │
                           ▼
            ┌──────────────────────────────────┐
            │   FASTAPI BACKEND (main.py)      │
            │   Running on localhost:8000      │
            │                                  │
            │  • Receives HTTP requests        │
            │  • Validates data (Pydantic)     │
            │  • Formats prompts for AI        │
            │  • Calls OpenAI API              │
            │  • Returns responses             │
            │  • Handles errors                │
            └──────────────┬───────────────────┘
                           │
                    (4) API Call
                    openai.chat.completions.create()
                    POST to api.openai.com
                           │
                           ▼
            ┌──────────────────────────────────┐
            │     OPENAI API (Cloud)           │
            │     GPT-4o-mini Model            │
            │                                  │
            │  • Receives article text         │
            │  • Processes with LLM            │
            │  • Generates summary             │
            │  • Returns AI response           │
            │  • Costs: ~$0.01 per summary     │
            └──────────────────────────────────┘
```

---

## Component Deep Dive

### 1. Manifest.json - Extension Configuration

**Purpose**: The blueprint for the Chrome extension. Tells Chrome what the extension does and what permissions it needs.

**Key Sections Explained**:

```json
{
  "manifest_version": 3,  
  // Using latest Manifest V3 (V2 is deprecated)
  
  "name": "Resonance",
  "version": "0.1.0",
  "description": "Talk to your articles. Remember everything.",
  
  "permissions": [
    "activeTab",    // Can read/modify the current active tab
    "storage",      // Can store data locally (future: conversation history)
    "scripting"     // Can inject scripts into webpages
  ],
  
  "host_permissions": [
    "http://localhost:8000/*",  // Can call local backend
    "<all_urls>"                // Can run on any website
  ],
  
  "action": {
    "default_popup": "popup/popup.html"  
    // What opens when user clicks extension icon
  },
  
  "content_scripts": [{
    "matches": ["<all_urls>"],     // Run on all websites
    "js": ["content/content.js"],  // Script to inject
    "run_at": "document_idle"      // When page is fully loaded
  }],
  
  "background": {
    "service_worker": "background/background.js"  
    // Always-running background script
  }
}
```

**Why Each Permission Matters**:
- `activeTab`: Without this, we can't read the article from the page
- `storage`: Will be used for saving conversation history
- `scripting`: Allows content script injection
- `<all_urls>`: Needed to work on any website

---

### 2. Content Script (content.js) - The Page Reader

**Purpose**: Acts as the "eyes" of the extension. It's the only part that can see and read the webpage's HTML.

**The Extraction Strategy**:

```javascript
function extractArticleContent() {
  // STEP 1: Try to find article container
  const articleSelectors = [
    'article',              // HTML5 semantic tag
    '[role="article"]',     // ARIA role
    '.article-content',     // Common class names
    '.post-content',
    '.entry-content',
    'main article',
    '.article-body'
  ];
  
  // STEP 2: Try each selector until we find content
  let content = '';
  for (const selector of articleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      content = element.innerText;  // Get all visible text
      break;
    }
  }
  
  // STEP 3: Fallback to main or body
  if (!content) {
    const main = document.querySelector('main') || document.querySelector('body');
    content = main ? main.innerText : document.body.innerText;
  }
  
  // STEP 4: Extract metadata
  const title = document.title;
  const url = window.location.href;
  const wordCount = content.split(/\s+/).length;
  
  // STEP 5: Return structured data
  return {
    success: true,
    article: {
      title: title,
      content: content.substring(0, 10000),  // Limit size
      url: url,
      length: wordCount,
      timestamp: new Date().toISOString()
    }
  };
}
```

**Why This Approach Works**:
- Most news sites and blogs use semantic HTML (`<article>` tag)
- We try multiple selectors to handle different site structures
- `innerText` gets only visible text (strips HTML tags, hidden elements)
- We have a fallback to `<body>` if specific selectors fail

---

### 3. Popup (popup.js) - The User Interface

**Initialization Flow**:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  // STEP 1: Wait for DOM to be ready
  
  // STEP 2: Get the current active tab
  const [tab] = await chrome.tabs.query({ 
    active: true,
    currentWindow: true
  });
  
  // STEP 3: Ask content script to extract article
  const response = await chrome.tabs.sendMessage(
    tab.id,
    { action: 'extractArticle' }
  );
  
  // STEP 4: Store the article data and update UI
  if (response && response.success) {
    currentArticle = response.article;
    showArticleInfo();
    setupEventListeners();
  }
});
```

**Button Handler - The Core Functionality**:

```javascript
async function querySummarize(type) {
  // STEP 1: Show loading UI
  document.getElementById('loading-response').classList.remove('hidden');

  try {
    // STEP 2: Make HTTP request to backend
    const response = await fetch(`${API_URL}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: currentArticle.title,
        content: currentArticle.content,
        url: currentArticle.url,
        type: type
      })
    });

    // STEP 3: Parse response
    const data = await response.json();
    
    // STEP 4: Display the summary
    showResponse(data.summary);
    
  } catch (error) {
    showError('Failed to connect to backend');
  }
}
```

---

### 4. Backend API (main.py) - The Processing Layer

**FastAPI Application Structure**:

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()

# CORS Configuration (allows Chrome extension to call API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data Model
class SummaryRequest(BaseModel):
    title: str
    content: str
    url: str
    type: str = "summary"

openai.api_key = os.getenv("OPENAI_API_KEY")

@app.post("/api/summarize")
async def summarize(request: SummaryRequest):
    try:
        # Format prompt
        if request.type == "key-points":
            system_prompt = "Extract key points as a bulleted list."
            user_prompt = f"Extract 5-7 key points:\n\n{request.content[:4000]}"
        else:
            system_prompt = "Provide clear, concise summaries."
            user_prompt = f"Summarize in 2-3 paragraphs:\n\n{request.content[:4000]}"
        
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
        
        return {
            "success": True,
            "summary": summary,
            "article_title": request.title,
            "type": request.type
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

---

## Data Flow: Step by Step

### Complete Flow: From Click to Summary

```
USER ACTION: Clicks extension icon on article page
    ↓
PHASE 1: INITIALIZATION
    1. popup.html loads
    2. popup.js queries current tab
    3. Sends message to content script
    
PHASE 2: CONTENT EXTRACTION
    4. content.js receives message
    5. Reads DOM using document.querySelector
    6. Extracts: title, content, URL, word count
    7. Sends data back to popup
    
PHASE 3: UI UPDATE
    8. popup.js receives article data
    9. Updates UI with title and word count
    10. Shows "Summarize" button
    
[USER CLICKS "SUMMARIZE ARTICLE"]
    
PHASE 4: BACKEND REQUEST
    11. Click handler fires
    12. Shows loading spinner
    13. Makes HTTP POST to backend
    
PHASE 5: BACKEND PROCESSING
    14. FastAPI receives request
    15. Validates data with Pydantic
    16. Formats prompt for OpenAI
    17. Calls OpenAI API
    
PHASE 6: AI PROCESSING
    18. OpenAI processes with GPT-4o-mini
    19. Generates summary (2-5 seconds)
    20. Returns response
    
PHASE 7: RESPONSE JOURNEY
    21. Backend extracts summary text
    22. Returns JSON to popup
    23. popup.js receives response
    24. Updates UI with summary
    
PHASE 8: USER SEES RESULT
    25. Summary displayed
    26. Copy button available
    27. Can request key points
```

### Timing Breakdown

| Action | Time | Component |
|--------|------|-----------|
| Popup loads | 50-100ms | Chrome |
| Article extraction | 100-300ms | content.js |
| HTTP request | 10-50ms | popup.js → backend |
| OpenAI processing | 2-5s | OpenAI servers |
| UI update | 50ms | popup.js |
| **TOTAL** | **2-6s** | End-to-end |

---

## Key Technologies Explained

### Chrome Extension APIs

**Message Passing**:
```javascript
// Send message
chrome.tabs.sendMessage(tabId, { action: 'doSomething' });

// Receive message
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  sendResponse({ result: 'success' });
  return true; // Required for async
});
```

**Storage** (future use):
```javascript
// Save
await chrome.storage.local.set({ key: 'value' });

// Retrieve
const data = await chrome.storage.local.get('key');
```

---

### FastAPI Key Features

**Automatic Validation**:
```python
class UserData(BaseModel):
    name: str
    age: int

@app.post("/user")
def create_user(data: UserData):
    # FastAPI validates automatically
    # Raises 422 if invalid
    return {"received": data}
```

**Interactive Docs**:
- Visit `http://localhost:8000/docs`
- Test API endpoints in browser
- Auto-generated from your code

---

### OpenAI API

**Message Format**:
```python
messages = [
    {"role": "system", "content": "You are helpful"},
    {"role": "user", "content": "Summarize this"},
    {"role": "assistant", "content": "Here's a summary"},
    {"role": "user", "content": "Tell me more"}
]
```

**Cost Optimization**:
- GPT-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
- Typical summary: $0.0005 (half a cent)
- Limit input to 4000 chars to control costs

---

## API Documentation

### POST /api/summarize

**Request**:
```json
{
  "title": "How to Make Wealth",
  "content": "Article text...",
  "url": "https://example.com/article",
  "type": "summary"
}
```

**Response**:
```json
{
  "success": true,
  "summary": "AI-generated summary...",
  "article_title": "How to Make Wealth",
  "type": "summary"
}
```

**Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | Yes | Article title |
| content | string | Yes | Article text (max 10K chars) |
| url | string | Yes | Article URL |
| type | string | No | "summary" or "key-points" |

**Status Codes**:
- 200: Success
- 422: Validation error
- 500: Server/OpenAI error

---

## Troubleshooting Guide

### Extension Won't Load

**Symptoms**: Error in chrome://extensions

**Solutions**:
1. Validate manifest.json syntax
2. Remove icon references if missing
3. Check file paths match manifest

**Debug**:
```powershell
python -c "import json; json.load(open('extension/manifest.json'))"
```

---

### "Could Not Extract Article"

**Symptoms**: Error in popup

**Causes**:
- Non-standard HTML structure
- Paywall/login required
- Dynamic content

**Solutions**:
1. Try different article (Wikipedia, Paul Graham)
2. Check browser console (F12)
3. Add selectors to content.js

---

### "Failed to Connect to Server"

**Symptoms**: Network error after "Summarize"

**Causes**:
- Backend not running
- Wrong port
- CORS issues

**Solutions**:
1. Start backend: `uvicorn main:app --reload`
2. Verify URL in popup.js
3. Check backend logs

**Test**:
```powershell
curl http://localhost:8000/health
```

---

### OpenAI API Errors

**Symptoms**: 500 error from backend

**Causes**:
- Invalid API key
- No credits
- Rate limit

**Solutions**:
1. Check .env file
2. Verify key at platform.openai.com
3. Check account credits

---

## Interview Talking Points

### 30-Second Pitch

> "Resonance is a Chrome extension that summarizes articles using AI. The architecture uses a Chrome extension for content extraction and UI, FastAPI backend for processing, and OpenAI GPT-4o-mini for summaries. I built it to solve the problem of information overload - you can instantly understand any article without reading the full text."

### 2-Minute Technical Overview

> "The system has four components. First, a Chrome extension with a content script that extracts article text from webpages using DOM selectors - it tries semantic tags first, then falls back to common patterns.
>
> Second, a popup UI that handles user interaction and makes HTTP requests to the backend when you click 'Summarize.'
>
> Third, a FastAPI backend in Python that validates requests with Pydantic, formats prompts, and calls the OpenAI API. I chose FastAPI for its async support and automatic documentation.
>
> Fourth, OpenAI GPT-4o-mini for AI generation - I chose this model for cost efficiency at $0.15 per million tokens while maintaining quality.
>
> The key architectural decision was using a backend layer instead of calling OpenAI directly from the extension. This keeps the API key secure and enables future features like caching, rate limiting, and RAG integration with a vector database."

### Challenges Overcome

**Content Extraction**:
> "Websites structure HTML differently. I solved this with a fallback selector system - semantic tags first, then class names, then broader selectors. This achieves ~90% success rate."

**Security**:
> "Can't expose API keys in client-side code. Backend layer solves this - key stays server-side, and I can add authentication later."

**Performance**:
> "OpenAI takes 2-5 seconds. I handle this with loading states, async/await, and limiting article size to 4000 chars for faster processing."

### Future Plans

> "Next: RAG with Pinecone for context-aware summaries based on reading history. Voice input with Web Speech API. Conversation history with PDF export. Analytics dashboard using my statistics background - topic clustering, reading trends, knowledge gaps."

---

## Quick Reference

### File Structure
```
resonance/
├── extension/
│   ├── manifest.json       # Extension config
│   ├── popup/
│   │   ├── popup.html     # UI structure
│   │   ├── popup.js       # UI logic
│   │   └── popup.css      # Styling
│   ├── content/
│   │   └── content.js     # Page extraction
│   └── background/
│       └── background.js  # Service worker
└── backend/
    ├── main.py            # FastAPI server
    ├── .env               # API keys
    └── requirements.txt   # Dependencies
```

### Useful Commands

```powershell
# Start backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload

# Test API
curl http://localhost:8000/health

# Check extension
# Visit: chrome://extensions/

# View logs
# Right-click extension → Inspect popup
```

### Key Concepts

| Concept | Purpose | Example |
|---------|---------|---------|
| Content Script | Read webpage | content.js |
| Message Passing | Component communication | chrome.tabs.sendMessage() |
| fetch() | HTTP requests | await fetch(url, {method: 'POST'}) |
| Pydantic | Data validation | class Model(BaseModel) |
| async/await | Non-blocking code | async def func(): await call() |

---

## Next Steps

1. **Add comments** to your code explaining each part
2. **Break something** intentionally and fix it (learn by debugging)
3. **Build a feature** (forces you to understand the whole system)
4. **Explain it** to someone (best way to solidify knowledge)

---

## Resources

- **Chrome Extensions**: https://developer.chrome.com/docs/extensions/
- **FastAPI**: https://fastapi.tiangolo.com/
- **OpenAI API**: https://platform.openai.com/docs/
- **Pydantic**: https://docs.pydantic.dev/

---

**Version History**:
- v0.1.0 (October 2025): Initial working version with extraction, summarization, and key points

**Built with**: FastAPI, OpenAI GPT-4o-mini, Chrome Extensions API

*This documentation is a living document. Update it as you learn and add features!*