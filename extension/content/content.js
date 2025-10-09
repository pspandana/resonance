chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractArticle') {
    const article = extractArticleContent();
    sendResponse(article);
  }
  return true;
});

function extractArticleContent() {
  try {
    const title = document.title;
    const url = window.location.href;
    let content = '';
    let author = '';
    
    // STEP 1: Try article-specific selectors
    const articleSelectors = [
      'article',
      '[role="article"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      'main article',
      '.article-body',
      '.post-body',
      '#article-content',
      '.story-body',
      '.content-body'
    ];
    
    console.log('🔍 Resonance: Looking for article content...');
    
    for (const selector of articleSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        content = element.innerText;
        console.log(`✅ Found content using: ${selector} (${content.length} chars)`);
        if (content.length > 500) {  // Only accept if substantial
          break;
        }
      }
    }
    
    // STEP 2: If no good content, try main
    if (!content || content.length < 500) {
      const main = document.querySelector('main');
      if (main) {
        content = main.innerText;
        console.log(`✅ Using main element (${content.length} chars)`);
      }
    }
    
    // STEP 3: Last resort - body (but filter out nav/footer)
    if (!content || content.length < 500) {
      const body = document.body;
      
      // Try to remove navigation and footer
      const clone = body.cloneNode(true);
      const removeSelectors = ['nav', 'header', 'footer', '.navigation', '.sidebar', '.comments'];
      removeSelectors.forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      });
      
      content = clone.innerText;
      console.log(`⚠️ Using body as fallback (${content.length} chars)`);
    }
    
    // STEP 4: Try to find author
    const authorSelectors = [
      '[rel="author"]',
      '.author-name',
      '.author',
      '[itemprop="author"]',
      '.byline',
      '.post-author'
    ];
    
    for (const selector of authorSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        author = element.innerText.trim();
        break;
      }
    }
    
    // Clean content
    content = content.trim();
    
    // Remove extra whitespace
    content = content.replace(/\s+/g, ' ');
    
    const wordCount = content.split(/\s+/).length;
    
    console.log(`📊 Final extraction: ${wordCount} words`);
    
    // Only send first 15000 chars to avoid issues
    const contentToSend = content.substring(0, 15000);
    
    return {
      success: true,
      article: {
        title: title,
        content: contentToSend,
        url: url,
        author: author,
        length: wordCount,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('❌ Resonance extraction error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}