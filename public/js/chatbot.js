/**
 * MIT TenderBot - AI Procurement Assistant Controller
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const Chatbot = {
  isOpen: false,
  history: [],
  isThinking: false,

  init() {
    this.bindEvents();
    this.loadSuggestions();
  },

  bindEvents() {
    const fabBtn = document.getElementById('ai-chat-trigger');
    const closeBtn = document.getElementById('ai-chat-close');
    const sendBtn = document.getElementById('ai-send-btn');
    const inputField = document.getElementById('ai-chat-input');

    if (fabBtn) {
      fabBtn.addEventListener('click', () => this.toggleChat());
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeChat());
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.handleSendMessage());
    }

    if (inputField) {
      inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendMessage();
        }
      });
    }
  },

  toggleChat() {
    this.isOpen = !this.isOpen;
    const windowEl = document.getElementById('ai-chat-window');
    const tooltip = document.getElementById('ai-chat-tooltip');

    if (windowEl) {
      if (this.isOpen) {
        windowEl.classList.add('active');
        if (tooltip) tooltip.style.display = 'none';
        const input = document.getElementById('ai-chat-input');
        if (input) input.focus();
        this.scrollToBottom();
      } else {
        windowEl.classList.remove('active');
      }
    }
  },

  closeChat() {
    this.isOpen = false;
    const windowEl = document.getElementById('ai-chat-window');
    if (windowEl) windowEl.classList.remove('active');
  },

  async loadSuggestions() {
    try {
      const res = await API.ai.getSuggestions();
      const container = document.getElementById('ai-quick-suggestions');
      if (container && res.suggestions && res.suggestions.length > 0) {
        container.innerHTML = res.suggestions.map(s => `
          <button class="ai-suggestion-chip" onclick="Chatbot.sendPrompt('${s.replace(/'/g, "\\'")}')">
            ${s}
          </button>
        `).join('');
      }
    } catch (err) {
      console.warn('Could not load AI suggestions:', err);
    }
  },

  sendPrompt(promptText) {
    const input = document.getElementById('ai-chat-input');
    if (input) {
      input.value = promptText;
      this.handleSendMessage();
    }
  },

  async handleSendMessage() {
    const input = document.getElementById('ai-chat-input');
    if (!input || this.isThinking) return;

    const message = input.value.trim();
    if (!message) return;

    input.value = '';

    // 1. Render User Message
    this.appendMessage('user', message);
    this.history.push({ role: 'user', content: message });

    // 2. Show Typing Indicator
    this.showTypingIndicator();
    this.isThinking = true;

    try {
      // 3. Call AI API
      const res = await API.ai.chat(message, this.history);
      this.hideTypingIndicator();

      if (res.success && res.response) {
        this.appendMessage('bot', res.response, res.relatedTenders);
        this.history.push({ role: 'assistant', content: res.response });
      } else {
        this.appendMessage('bot', 'I encountered an issue processing your query. Please try again.');
      }
    } catch (err) {
      this.hideTypingIndicator();
      this.appendMessage('bot', `⚠️ Could not reach MIT Procurement AI: ${err.message}`);
    } finally {
      this.isThinking = false;
    }
  },

  appendMessage(sender, text, relatedTenders = []) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return;

    const formattedHtml = this.formatMarkdown(text);

    let tendersHtml = '';
    if (relatedTenders && relatedTenders.length > 0) {
      tendersHtml = `
        <div class="mt-2 pt-2 border-top">
          <small class="text-muted fw-bold d-block mb-1">🔗 Direct Action:</small>
          <div class="d-flex flex-wrap gap-1">
            ${relatedTenders.map(t => `
              <button class="btn btn-xs btn-outline-primary py-1 px-2 text-truncate" style="max-width: 100%; font-size: 0.75rem;" onclick="viewTenderDetails(${t.id})">
                <i class="bi bi-eye me-1"></i> View ${t.tender_code}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    const msgEl = document.createElement('div');
    msgEl.className = `ai-message ${sender}`;
    msgEl.innerHTML = `
      ${sender === 'bot' ? `<div class="ai-avatar"><i class="bi bi-robot"></i></div>` : ''}
      <div class="ai-msg-bubble">
        ${formattedHtml}
        ${tendersHtml}
      </div>
    `;

    messagesContainer.appendChild(msgEl);
    this.scrollToBottom();
  },

  showTypingIndicator() {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return;

    let indicator = document.getElementById('ai-typing-indicator-box');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'ai-typing-indicator-box';
      indicator.className = 'ai-message bot';
      indicator.innerHTML = `
        <div class="ai-avatar"><i class="bi bi-robot"></i></div>
        <div class="ai-typing-indicator">
          <span></span><span></span><span></span>
        </div>
      `;
      messagesContainer.appendChild(indicator);
    }
    this.scrollToBottom();
  },

  hideTypingIndicator() {
    const indicator = document.getElementById('ai-typing-indicator-box');
    if (indicator) indicator.remove();
  },

  scrollToBottom() {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  },

  formatMarkdown(text) {
    if (!text) return '';
    let parsed = text
      .replace(/### (.*?)\n/g, '<h3>$1</h3>')
      .replace(/## (.*?)\n/g, '<h4 class="fw-bold">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-light px-1 py-0.5 rounded text-dark">$1</code>')
      .replace(/> (.*?)\n/g, '<blockquote>$1</blockquote>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n- /g, '<br>• ')
      .replace(/\n\d+\. /g, (match) => `<br>${match.trim()} `);

    return parsed;
  }
};

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  Chatbot.init();
});
