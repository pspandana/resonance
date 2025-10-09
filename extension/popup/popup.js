const API_URL = 'http://localhost:8000';

let currentArticle = null;
let currentConversationId = null;
let currentView = 'current';
let currentMessages = []; // Track messages in current conversation

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Extract article from current page
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' });
    
    if (response && response.success) {
      currentArticle = response.article;
      
      // Check if we have an existing conversation for this URL
      await checkExistingConversation(currentArticle.url);
      
      showArticleInfo();
      setupEventListeners();
    } else {
      showError('Could not extract article from this page. Try a different article or blog post.');
    }
  } catch (error) {
    console.error('Error:', error);
    showError('Failed to read the page. Make sure you\'re on an article or blog post.');
  }
});

async function checkExistingConversation(url) {
  // Check if there's an ongoing conversation for this article
  const data = await chrome.storage.local.get(['conversations']);
  const conversations = data.conversations || [];
  
  // Find conversation for this URL from today
  const today = new Date().toDateString();
  const existing = conversations.find(conv => 
    conv.article_url === url && 
    new Date(conv.started_at).toDateString() === today
  );
  
  if (existing) {
    currentConversationId = existing.id;
    currentMessages = existing.messages || [];
  } else {
    // Create new conversation ID
    currentConversationId = generateId();
    currentMessages = [];
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showArticleInfo() {
  const articleInfo = document.getElementById('article-info');
  articleInfo.innerHTML = `
    <h2>${currentArticle.title || 'Untitled Article'}</h2>
    <div class="article-meta">
      ${currentArticle.author ? `By ${currentArticle.author} • ` : ''}
      ${currentArticle.length || '0'} words
    </div>
  `;
  
  document.getElementById('controls').classList.remove('hidden');
  updateStatus('Ready');
}

function setupEventListeners() {
  // Tab switching
  document.getElementById('tab-current').addEventListener('click', () => switchView('current'));
  document.getElementById('tab-history').addEventListener('click', () => switchView('history'));
  
  // Summarize button
  document.getElementById('summarize-btn').addEventListener('click', () => {
    querySummarize('summary');
  });

  // Key points button
  document.getElementById('key-points-btn').addEventListener('click', () => {
    querySummarize('key-points');
  });

  // Copy button
  document.getElementById('copy-btn').addEventListener('click', copyResponse);

  // Retry button
  document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('error-container').classList.add('hidden');
    document.getElementById('controls').classList.remove('hidden');
  });

  // Text Q&A input handlers
  const queryInput = document.getElementById('query-input');
  const sendBtn = document.getElementById('send-btn');
  
  // Show send button when typing
  queryInput.addEventListener('input', (e) => {
    if (e.target.value.trim()) {
      sendBtn.style.display = 'block';
    } else {
      sendBtn.style.display = 'none';
    }
  });
  
  // Send on button click
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const question = queryInput.value.trim();
      if (question) {
        askQuestion(question);
        queryInput.value = '';
        sendBtn.style.display = 'none';
      }
    });
  }
  
  // Send on Enter key
  queryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const question = queryInput.value.trim();
      if (question) {
        askQuestion(question);
        queryInput.value = '';
        sendBtn.style.display = 'none';
      }
    }
  });

  // History buttons
  document.getElementById('refresh-history').addEventListener('click', loadHistory);
  document.getElementById('back-to-list').addEventListener('click', () => {
    document.getElementById('conversation-detail').classList.add('hidden');
    document.getElementById('history-list').classList.remove('hidden');
  });
}

// View Switching
function switchView(view) {
  currentView = view;
  
  // Update tabs
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  
  if (view === 'current') {
    document.getElementById('tab-current').classList.add('active');
    document.getElementById('current-view').classList.remove('hidden');
    document.getElementById('history-view').classList.add('hidden');
  } else {
    document.getElementById('tab-history').classList.add('active');
    document.getElementById('current-view').classList.add('hidden');
    document.getElementById('history-view').classList.remove('hidden');
    loadHistory();
  }
}

// Save conversation to local storage
async function saveConversation() {
  if (currentMessages.length === 0) return;
  
  const data = await chrome.storage.local.get(['conversations']);
  let conversations = data.conversations || [];
  
  // Find existing conversation or create new one
  const existingIndex = conversations.findIndex(c => c.id === currentConversationId);
  
  const conversation = {
    id: currentConversationId,
    article_title: currentArticle.title,
    article_url: currentArticle.url,
    started_at: existingIndex >= 0 ? conversations[existingIndex].started_at : new Date().toISOString(),
    last_updated: new Date().toISOString(),
    messages: currentMessages,
    message_count: currentMessages.length,
    first_question: currentMessages.find(m => m.role === 'user')?.content || ''
  };
  
  if (existingIndex >= 0) {
    conversations[existingIndex] = conversation;
  } else {
    conversations.unshift(conversation); // Add to beginning
  }
  
  // Keep only last 50 conversations
  if (conversations.length > 50) {
    conversations = conversations.slice(0, 50);
  }
  
  await chrome.storage.local.set({ conversations });
}

// Ask a question about the article
async function askQuestion(question) {
  if (!currentArticle) {
    showError('No article loaded');
    return;
  }

  // Add user message to current conversation
  currentMessages.push({
    role: 'user',
    content: question,
    created_at: new Date().toISOString()
  });

  // Show loading
  document.getElementById('controls').classList.add('hidden');
  document.getElementById('response-container').classList.add('hidden');
  document.getElementById('loading-response').classList.remove('hidden');
  updateStatus('Processing...');

  try {
    const response = await fetch(`${API_URL}/api/question`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: question,
        title: currentArticle.title,
        content: currentArticle.content,
        url: currentArticle.url,
        conversation_id: currentConversationId
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    
    // Add assistant response to current conversation
    currentMessages.push({
      role: 'assistant',
      content: data.answer,
      created_at: new Date().toISOString()
    });
    
    // Save to local storage
    await saveConversation();
    
    showResponse(data.answer, 'question');
    
  } catch (error) {
    console.error('Error:', error);
    // Remove the user message if request failed
    currentMessages.pop();
    showError(`Failed to get answer. Make sure backend is running at ${API_URL}`);
  } finally {
    document.getElementById('loading-response').classList.add('hidden');
  }
}

async function querySummarize(type) {
  if (!currentArticle) {
    showError('No article loaded');
    return;
  }

  const promptText = type === 'summary' ? 'Summarize this article' : 'Give me the key points';
  
  // Add to conversation
  currentMessages.push({
    role: 'user',
    content: promptText,
    created_at: new Date().toISOString()
  });

  // Show loading
  document.getElementById('controls').classList.add('hidden');
  document.getElementById('response-container').classList.add('hidden');
  document.getElementById('loading-response').classList.remove('hidden');
  updateStatus('Processing...');

  try {
    const response = await fetch(`${API_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: currentArticle.title,
        content: currentArticle.content,
        url: currentArticle.url,
        type: type,
        conversation_id: currentConversationId
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    
    // Add assistant response
    currentMessages.push({
      role: 'assistant',
      content: data.summary,
      created_at: new Date().toISOString()
    });
    
    // Save to local storage
    await saveConversation();
    
    showResponse(data.summary, type);
  } catch (error) {
    console.error('Error:', error);
    // Remove the user message if request failed
    currentMessages.pop();
    showError(`Failed to connect to Resonance server. Make sure the backend is running at ${API_URL}`);
  } finally {
    document.getElementById('loading-response').classList.add('hidden');
  }
}

function showResponse(text, type) {
  const responseElement = document.getElementById('response-content');
  
  // Format key points as a list
  if (type === 'key-points' || text.includes('•')) {
    const lines = text.split(/\n|•/).filter(line => line.trim());
    const listHTML = '<ul>' + 
      lines.map(line => `<li>${line.trim()}</li>`).join('') + 
      '</ul>';
    responseElement.innerHTML = listHTML;
  } else {
    // Regular text - preserve paragraphs
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    const htmlText = paragraphs.map(p => `<p>${p}</p>`).join('');
    responseElement.innerHTML = htmlText || `<p>${text}</p>`;
  }
  
  document.getElementById('response-container').classList.remove('hidden');
  document.getElementById('controls').classList.remove('hidden');
  updateStatus('Complete');
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-container').classList.remove('hidden');
  document.getElementById('controls').classList.add('hidden');
  updateStatus('Error');
}

function copyResponse() {
  const text = document.getElementById('response-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = '✅';
    setTimeout(() => {
      btn.textContent = '📋';
    }, 2000);
  });
}

function updateStatus(status) {
  document.getElementById('status').textContent = status;
}

// ============================================
// HISTORY FUNCTIONS (NOW USING LOCAL STORAGE)
// ============================================

async function loadHistory() {
  console.log('Loading history...');
  const historyList = document.getElementById('history-list');
  const historyLoading = document.getElementById('history-loading');
  const historyEmpty = document.getElementById('history-empty');
  
  // Show loading
  historyLoading.classList.remove('hidden');
  historyList.innerHTML = '';
  historyEmpty.classList.add('hidden');
  
  try {
    // Get conversations from local storage
    const data = await chrome.storage.local.get(['conversations']);
    console.log('Retrieved data:', data);
    const conversations = data.conversations || [];
    console.log('Number of conversations:', conversations.length);
    
    // Always hide loading spinner
    historyLoading.classList.add('hidden');
    
    if (conversations.length > 0) {
      historyList.innerHTML = '';
      conversations.forEach(conv => {
        const item = createConversationItem(conv);
        historyList.appendChild(item);
      });
      console.log('Displayed', conversations.length, 'conversations');
    } else {
      historyEmpty.classList.remove('hidden');
      console.log('No conversations found - showing empty state');
    }
  } catch (error) {
    console.error('Error loading history:', error);
    historyLoading.classList.add('hidden');
    historyEmpty.classList.remove('hidden');
  }
}

function createConversationItem(conversation) {
  const div = document.createElement('div');
  div.className = 'conversation-item';
  
  const date = new Date(conversation.started_at);
  const timeAgo = getTimeAgo(date);
  
  div.innerHTML = `
    <div class="conversation-title">${conversation.article_title}</div>
    <div class="conversation-meta">${timeAgo} • ${conversation.message_count} messages</div>
    ${conversation.first_question ? `<div class="conversation-preview">"${conversation.first_question}"</div>` : ''}
  `;
  
  div.addEventListener('click', () => viewConversation(conversation.id));
  
  return div;
}

async function viewConversation(conversationId) {
  const detailView = document.getElementById('conversation-detail');
  const messagesList = document.getElementById('detail-messages');
  
  // Hide list, show detail
  document.getElementById('history-list').classList.add('hidden');
  detailView.classList.remove('hidden');
  
  // Show loading
  messagesList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading conversation...</p></div>';
  
  try {
    // Get conversation from local storage
    const data = await chrome.storage.local.get(['conversations']);
    const conversations = data.conversations || [];
    const conversation = conversations.find(c => c.id === conversationId);
    
    if (conversation && conversation.messages && conversation.messages.length > 0) {
      messagesList.innerHTML = '';
      conversation.messages.forEach(msg => {
        const msgDiv = createMessageItem(msg);
        messagesList.appendChild(msgDiv);
      });
    } else {
      messagesList.innerHTML = '<p style="text-align:center;color:#6b7280;padding:20px;">No messages found</p>';
    }
  } catch (error) {
    console.error('Error loading conversation:', error);
    messagesList.innerHTML = '<p style="text-align:center;color:#dc2626;padding:20px;">Error loading messages</p>';
  }
}

function createMessageItem(message) {
  const div = document.createElement('div');
  div.className = `message-item ${message.role}`;
  
  const time = new Date(message.created_at);
  
  div.innerHTML = `
    <div class="message-role">${message.role === 'user' ? '👤 You' : '🤖 Resonance'}</div>
    <div class="message-content">${message.content}</div>
    <div class="message-time">${time.toLocaleTimeString()}</div>
  `;
  
  return div;
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}