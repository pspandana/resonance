const API_URL = 'https://resonance-backend-spandanap-aue0e7hwgsaeamcu.canadacentral-01.azurewebsites.net';

let currentArticle = null;
let currentConversationId = null;
let currentView = 'current';
let currentMessages = [];

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎵 Resonance popup loaded');
  
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if we can access this tab
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showError('Cannot read this page. Please open an article on a regular website.');
      return;
    }
    
    // Try to extract article
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' });
      
      if (response && response.success) {
        currentArticle = response.article;
        await checkExistingConversation(currentArticle.url);
        showArticleInfo();
        setupEventListeners();
        console.log('✅ Article loaded:', currentArticle.title);
      } else {
        showError('Could not extract article from this page. Try a different article or blog post.');
      }
    } catch (msgError) {
      console.error('❌ Message error:', msgError);
      showError('Please refresh the page and try again.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    showError('Failed to read the page. Make sure you\'re on an article or blog post.');
  }
  
  // Setup search functionality
  setupSearchListener();
});

async function checkExistingConversation(url) {
  const data = await chrome.storage.local.get(['conversations']);
  const conversations = data.conversations || [];
  
  const today = new Date().toDateString();
  const existing = conversations.find(conv => 
    conv.article_url === url && 
    new Date(conv.started_at).toDateString() === today
  );
  
  if (existing) {
    currentConversationId = existing.id;
    currentMessages = existing.messages || [];
  } else {
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
  console.log('🔧 Setting up event listeners...');
  
  // Tab switching
  document.getElementById('tab-current').addEventListener('click', () => switchView('current'));
  document.getElementById('tab-history').addEventListener('click', () => {
    console.log('👆 History tab clicked');
    switchView('history');
  });
  
  // Quick action buttons
  document.getElementById('summarize-btn').addEventListener('click', () => {
    querySummarize('summary');
  });

  document.getElementById('key-points-btn').addEventListener('click', () => {
    querySummarize('key-points');
  });

  document.getElementById('copy-btn').addEventListener('click', copyResponse);

  document.getElementById('retry-btn').addEventListener('click', () => {
    document.getElementById('error-container').classList.add('hidden');
    document.getElementById('controls').classList.remove('hidden');
  });

  // Q&A input
  const queryInput = document.getElementById('query-input');
  const sendBtn = document.getElementById('send-btn');
  
  queryInput.addEventListener('input', (e) => {
    if (e.target.value.trim()) {
      sendBtn.style.display = 'block';
    } else {
      sendBtn.style.display = 'none';
    }
  });
  
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
  document.getElementById('refresh-history').addEventListener('click', () => {
    console.log('🔄 Refresh clicked');
    loadHistory();
  });
  
  document.getElementById('back-to-list').addEventListener('click', () => {
    document.getElementById('conversation-detail').classList.add('hidden');
    document.getElementById('history-list').classList.remove('hidden');
  });
  
  console.log('✅ Event listeners set up');
}

function setupSearchListener() {
  const searchInput = document.querySelector('.search-input');
  
  if (searchInput) {
    console.log('🔍 Setting up search listener');
    searchInput.addEventListener('input', async (e) => {
      const query = e.target.value.toLowerCase().trim();
      console.log('⌨️ Searching:', query);
      
      const data = await chrome.storage.local.get(['conversations']);
      const conversations = data.conversations || [];
      
      if (!query) {
        displayConversations(conversations);
        return;
      }
      
      // Filter conversations
      const filtered = conversations.filter(conv => 
        conv.article_title?.toLowerCase().includes(query) ||
        conv.first_question?.toLowerCase().includes(query) ||
        conv.messages?.some(m => m.content.toLowerCase().includes(query))
      );
      
      console.log('✅ Found', filtered.length, 'results');
      
      if (filtered.length > 0) {
        displayConversations(filtered);
      } else {
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = `
          <div style="text-align:center;padding:60px 20px;color:#6b7280;">
            <div style="font-size:48px;margin-bottom:16px;">🔍</div>
            <p style="font-size:15px;font-weight:500;margin-bottom:8px;">No results found</p>
            <p style="font-size:13px;">Try different keywords</p>
          </div>
        `;
      }
    });
  }
}

function switchView(view) {
  console.log('🔄 Switching to view:', view);
  currentView = view;
  
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

async function saveConversation() {
  if (currentMessages.length === 0) return;
  
  const data = await chrome.storage.local.get(['conversations']);
  let conversations = data.conversations || [];
  
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
    conversations.unshift(conversation);
  }
  
  if (conversations.length > 50) {
    conversations = conversations.slice(0, 50);
  }
  
  await chrome.storage.local.set({ conversations });
}

async function askQuestion(question) {
  if (!currentArticle) {
    showError('No article loaded');
    return;
  }

  currentMessages.push({
    role: 'user',
    content: question,
    created_at: new Date().toISOString()
  });

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
    
    currentMessages.push({
      role: 'assistant',
      content: data.answer,
      created_at: new Date().toISOString()
    });
    
    await saveConversation();
    showResponse(data.answer, 'question');
    
  } catch (error) {
    console.error('Error:', error);
    currentMessages.pop();
    showError(`Failed to get answer. Make sure backend is running.`);
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
  
  currentMessages.push({
    role: 'user',
    content: promptText,
    created_at: new Date().toISOString()
  });

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
    
    currentMessages.push({
      role: 'assistant',
      content: data.summary,
      created_at: new Date().toISOString()
    });
    
    await saveConversation();
    showResponse(data.summary, type);
  } catch (error) {
    console.error('Error:', error);
    currentMessages.pop();
    showError(`Failed to connect to server.`);
  } finally {
    document.getElementById('loading-response').classList.add('hidden');
  }
}

function showResponse(text, type) {
  const responseElement = document.getElementById('response-content');
  
  if (type === 'key-points' || text.includes('•')) {
    const lines = text.split(/\n|•/).filter(line => line.trim());
    const listHTML = '<ul>' + 
      lines.map(line => `<li>${line.trim()}</li>`).join('') + 
      '</ul>';
    responseElement.innerHTML = listHTML;
  } else {
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
// HISTORY FUNCTIONS
// ============================================

async function loadHistory() {
  console.log('📚 Loading history...');
  const historyList = document.getElementById('history-list');
  const historyLoading = document.getElementById('history-loading');
  const historyEmpty = document.getElementById('history-empty');
  
  // Show loading
  historyLoading.classList.remove('hidden');
  historyList.innerHTML = '';
  historyEmpty.classList.add('hidden');
  
  // Clear search
  const searchInput = document.querySelector('.search-input');
  if (searchInput) {
    searchInput.value = '';
  }
  
  try {
    const data = await chrome.storage.local.get(['conversations']);
    const conversations = data.conversations || [];
    console.log('📊 Found', conversations.length, 'conversations');
    
    historyLoading.classList.add('hidden');
    
    if (conversations.length > 0) {
      displayConversations(conversations);
    } else {
      historyEmpty.classList.remove('hidden');
    }
    
  } catch (error) {
    console.error('❌ Error loading history:', error);
    historyLoading.classList.add('hidden');
    historyEmpty.classList.remove('hidden');
  }
}

function displayConversations(conversations) {
  console.log('📋 Displaying', conversations.length, 'conversations');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  
  if (conversations.length > 0) {
    historyList.innerHTML = '';
    conversations.forEach(conv => {
      const item = createConversationItem(conv);
      historyList.appendChild(item);
    });
    historyEmpty.classList.add('hidden');
  } else {
    historyList.innerHTML = '';
    historyEmpty.classList.remove('hidden');
  }
}

function createConversationItem(conversation) {
  const div = document.createElement('div');
  div.className = 'conversation-item';
  
  const date = new Date(conversation.started_at);
  const timeAgo = getTimeAgo(date);
  
  div.innerHTML = `
    <div class="conversation-title">
      <a href="${conversation.article_url}" target="_blank" class="article-link">
        ${conversation.article_title || 'Untitled'}
      </a>
    </div>
    <div class="conversation-meta">${timeAgo} • ${conversation.message_count} messages</div>
    ${conversation.first_question ? `<div class="conversation-preview">"${conversation.first_question}"</div>` : ''}
  `;
  
  // Open article in new tab when clicking title
  const link = div.querySelector('.article-link');
  if (link) {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('🔗 Opening article:', conversation.article_url);
      chrome.tabs.create({ url: conversation.article_url });
    });
  }
  
  // View conversation when clicking card
  div.addEventListener('click', (e) => {
    if (!e.target.classList.contains('article-link')) {
      console.log('💬 Opening conversation:', conversation.id);
      viewConversation(conversation.id);
    }
  });
  
  return div;
}

async function viewConversation(conversationId) {
  console.log('👁️ Viewing conversation:', conversationId);
  const detailView = document.getElementById('conversation-detail');
  const messagesList = document.getElementById('detail-messages');
  
  document.getElementById('history-list').classList.add('hidden');
  detailView.classList.remove('hidden');
  
  messagesList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
  
  try {
    const data = await chrome.storage.local.get(['conversations']);
    const conversations = data.conversations || [];
    const conversation = conversations.find(c => c.id === conversationId);
    
    if (conversation && conversation.messages && conversation.messages.length > 0) {
      messagesList.innerHTML = '';
      conversation.messages.forEach(msg => {
        const msgDiv = createMessageItem(msg);
        messagesList.appendChild(msgDiv);
      });
      console.log('✅ Loaded', conversation.messages.length, 'messages');
    } else {
      messagesList.innerHTML = '<p style="text-align:center;color:#6b7280;padding:20px;">No messages</p>';
    }
  } catch (error) {
    console.error('❌ Error loading conversation:', error);
    messagesList.innerHTML = '<p style="text-align:center;color:#dc2626;padding:20px;">Error loading</p>';
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