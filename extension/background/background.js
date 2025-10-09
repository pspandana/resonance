// Background service worker

console.log('Resonance background script loaded');

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Resonance installed successfully!');
});

// You can add background tasks here later
// For now, this is just a placeholder