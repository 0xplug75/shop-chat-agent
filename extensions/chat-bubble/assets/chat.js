/**
 * Shop AI Chat - Client-side implementation
 *
 * This module handles the chat interface for the Shopify AI Chat application.
 * It manages the UI interactions, API communication, and message rendering.
 */
(function() {
  'use strict';

  /**
   * Application namespace to prevent global scope pollution
   */
  const ShopAIChat = {
    /**
     * Storefront-safe merchant configuration loaded from the backend.
     */
    Config: {
      defaults: {
        assistant: {
          name: 'Store Assistant',
          welcomeMessage: window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?",
          quickActions: [
            "Find the right product",
            "Compare options",
            "Ready to buy"
          ]
        },
        widget: {
          position: window.shopChatConfig?.widget?.position || 'bottom-right',
          layout: window.shopChatConfig?.widget?.layout || 'bubble',
          primaryCtaLabel: window.shopChatConfig?.widget?.primaryCtaLabel || 'Shop with chat',
          launcherLabel: window.shopChatConfig?.widget?.launcherLabel || 'Ask Sage',
          launcherStyle: window.shopChatConfig?.widget?.launcherStyle || 'label',
          cornerRadius: window.shopChatConfig?.widget?.cornerRadius || 12,
          colors: window.shopChatConfig?.widget?.colors || {},
          behavior: {
            openOnLoad: window.shopChatConfig?.widget?.behavior?.openOnLoad || false,
            showQuickActions: window.shopChatConfig?.widget?.behavior?.showQuickActions !== false,
            entryBehavior: window.shopChatConfig?.widget?.behavior?.entryBehavior || 'auto',
            allowFullscreen: true
          }
        }
      },
      quickActionPrompts: {
        "Find the right product": "I need help finding the right product for me. Ask me what matters and recommend the best options.",
        "Compare options": "Compare the best products for my needs and explain which one I should choose.",
        "Ready to buy": "Show me products that are available now and help me add the best one to cart."
      },
      merchantConfig: null,

      /**
       * Load public merchant config. Failure keeps Liquid/static fallbacks.
       * @returns {Promise<Object>} Effective merchant config
       */
      load: async function() {
        const fallbackConfig = this.getEffectiveConfig();

        try {
          const bootstrap = await ShopAIChat.API.ensureBootstrap();
          const publicConfig = bootstrap.config;
          this.merchantConfig = publicConfig;
          this.applyToWindowConfig(publicConfig);
        } catch (error) {
          console.warn('[IntentCart] merchant config unavailable, using storefront defaults:', error.message);
          this.merchantConfig = fallbackConfig;
        }

        return this.getEffectiveConfig();
      },

      getEffectiveConfig: function() {
        const mergedConfig = this.mergeConfig(this.defaults, this.merchantConfig || {});
        const themeWidgetConfig = window.shopChatConfig?.widget;

        if (themeWidgetConfig) {
          mergedConfig.widget = this.mergeConfig(mergedConfig.widget || {}, themeWidgetConfig);
        }

        if (window.shopChatConfig?.welcomeMessage) {
          mergedConfig.assistant = {
            ...(mergedConfig.assistant || {}),
            welcomeMessage: window.shopChatConfig.welcomeMessage
          };
        }

        return mergedConfig;
      },

      applyToWindowConfig: function(config) {
        const themeWidgetConfig = window.shopChatConfig?.widget || {};
        const mergedWidgetConfig = this.mergeConfig(config.widget || this.defaults.widget, themeWidgetConfig);

        window.shopChatConfig = {
          ...(window.shopChatConfig || {}),
          assistantName: config.assistant?.name || this.defaults.assistant.name,
          welcomeMessage: window.shopChatConfig?.welcomeMessage || config.assistant?.welcomeMessage || this.defaults.assistant.welcomeMessage,
          quickActions: config.assistant?.quickActions || this.defaults.assistant.quickActions,
          widget: mergedWidgetConfig
        };
      },

      mergeConfig: function(baseConfig, overrideConfig) {
        const merged = { ...baseConfig };

        Object.keys(overrideConfig || {}).forEach((key) => {
          const value = overrideConfig[key];
          if (value && typeof value === 'object' && !Array.isArray(value) && baseConfig[key]) {
            merged[key] = this.mergeConfig(baseConfig[key], value);
          } else if (Array.isArray(value)) {
            merged[key] = [...value];
          } else if (value !== undefined) {
            merged[key] = value;
          }
        });

        return merged;
      },

      getQuickActionPrompt: function(label) {
        return this.quickActionPrompts[label] || label;
      }
    },

    /**
     * UI-related elements and functionality
     */
    UI: {
      elements: {},
      isMobile: false,
      lastFocusedElement: null,

      /**
       * Initialize UI elements and event listeners
       * @param {HTMLElement} container - The main container element
       */
      init: function(container) {
        if (!container) return;

        // Cache DOM elements
        this.elements = {
          container: container,
          chatBubble: container.querySelector('.shop-ai-chat-bubble'),
          choicePanel: container.querySelector('.shop-ai-choice-panel'),
          choiceCloseButton: container.querySelector('.shop-ai-choice-close'),
          startChatButton: container.querySelector('.shop-ai-start-chat'),
          continueBrowsingButton: container.querySelector('.shop-ai-continue-browsing'),
          chatWindow: container.querySelector('.shop-ai-chat-window'),
          closeButton: container.querySelector('.shop-ai-chat-close'),
          chatInput: container.querySelector('.shop-ai-chat-input input'),
          sendButton: container.querySelector('.shop-ai-chat-send'),
          messagesContainer: container.querySelector('.shop-ai-chat-messages'),
          suggestionsContainer: container.querySelector('.shop-ai-suggestions'),
          promptButtons: container.querySelectorAll('[data-shop-ai-prompt]'),
          assistantNameNodes: container.querySelectorAll('[data-shop-ai-assistant-name]')
        };

        // Detect mobile device
        this.isMobile =
          /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
          window.matchMedia('(max-width: 640px)').matches;

        // Apply merchant widget settings before binding handlers.
        this.applyMerchantConfig(container);

        // Set up event listeners
        this.setupEventListeners();

        // Fix for iOS Safari viewport height issues
        if (this.isMobile) {
          this.setupMobileViewport();
        }

        this.updateSendState();
        this.applyInitialWidgetBehavior();
      },

      /**
       * Set up all event listeners for UI interactions
       */
      setupEventListeners: function() {
        const {
          chatBubble,
          choiceCloseButton,
          startChatButton,
          continueBrowsingButton,
          closeButton,
          chatInput,
          sendButton,
          messagesContainer,
          promptButtons
        } = this.elements;

        chatBubble?.addEventListener('click', () => {
          this.lastFocusedElement = chatBubble;
          if (this.opensDirectly()) {
            this.openChatMode();
          } else {
            this.openChoicePanel();
          }
        });

        choiceCloseButton?.addEventListener('click', () => {
          this.closeChoicePanel();
          chatBubble?.focus();
        });
        continueBrowsingButton?.addEventListener('click', () => {
          this.closeChoicePanel();
          chatBubble?.focus();
        });
        startChatButton?.addEventListener('click', () => this.openChatMode());

        // Close chat window
        closeButton?.addEventListener('click', () => this.closeChatWindow());

        // Send message when pressing Enter in input
        chatInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            e.preventDefault();
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, handle keyboard
            if (this.isMobile) {
              chatInput.blur();
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        chatInput?.addEventListener('input', () => this.updateSendState());

        // Send message when clicking send button
        sendButton?.addEventListener('click', () => {
          if (chatInput.value.trim() !== '') {
            ShopAIChat.Message.send(chatInput, messagesContainer);

            // On mobile, focus input after sending
            if (this.isMobile) {
              setTimeout(() => chatInput.focus(), 300);
            }
          }
        });

        promptButtons.forEach((button) => {
          button.addEventListener('click', () => {
            chatInput.value = button.dataset.shopAiPrompt || button.textContent.trim();
            ShopAIChat.Message.send(chatInput, messagesContainer);
          });
        });

        document.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return;

          if (this.elements.chatWindow?.classList.contains('active')) {
            this.closeChatWindow();
          } else if (this.elements.choicePanel?.classList.contains('active')) {
            this.closeChoicePanel();
            this.elements.chatBubble?.focus();
          }
        });

        // Handle window resize to adjust scrolling
        window.addEventListener('resize', () => this.scrollToBottom());

        // Add global click handler for auth links
        document.addEventListener('click', function(event) {
          if (event.target && event.target.classList.contains('shop-auth-trigger')) {
            event.preventDefault();
            if (window.shopAuthUrl) {
              ShopAIChat.Auth.openAuthPopup(window.shopAuthUrl);
            }
          }
        });
      },

      /**
       * Apply storefront-safe merchant config to the existing widget surface.
       * @param {HTMLElement} container - The main container element
       */
      applyMerchantConfig: function(container) {
        const config = ShopAIChat.Config.getEffectiveConfig();
        const widgetConfig = config.widget || {};
        const assistantConfig = config.assistant || {};
        const colors = widgetConfig.colors || {};

        this.applyWidgetPosition(container, widgetConfig.position);
        this.applyWidgetLayout(container, widgetConfig.layout);

        if (colors.primary) container.style.setProperty('--shop-ai-primary', colors.primary);
        if (colors.background) container.style.setProperty('--shop-ai-background', colors.background);
        if (colors.text) container.style.setProperty('--shop-ai-text', colors.text);
        if (colors.accent) container.style.setProperty('--shop-ai-accent', colors.accent);

        if (this.elements.startChatButton && widgetConfig.primaryCtaLabel) {
          this.elements.startChatButton.textContent = widgetConfig.primaryCtaLabel;
        }

        if (widgetConfig.cornerRadius !== undefined) {
          const radius = Math.max(0, Math.min(24, Number(widgetConfig.cornerRadius) || 0));
          container.style.setProperty('--shop-ai-radius', `${radius}px`);
        }

        this.elements.assistantNameNodes?.forEach((node) => {
          node.textContent = assistantConfig.name || ShopAIChat.Config.defaults.assistant.name;
        });

        this.renderQuickActions(assistantConfig.quickActions, widgetConfig.behavior);
      },

      updateSendState: function() {
        const { chatInput, sendButton } = this.elements;
        if (!chatInput || !sendButton) return;

        sendButton.disabled = chatInput.value.trim().length === 0;
      },

      /**
       * Apply one of the supported merchant widget positions.
       * @param {HTMLElement} container - The main container element
       * @param {string} position - Merchant widget position
       */
      applyWidgetPosition: function(container, position) {
        const supportedPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
        const safePosition = supportedPositions.includes(position) ? position : 'bottom-right';
        const dockSide = safePosition.includes('left') ? 'left' : 'right';
        const dockOrigin = safePosition.includes('top') ? 'top' : 'bottom';

        supportedPositions.forEach((item) => {
          container.classList.remove(`shop-ai-position-${item}`);
        });
        container.classList.remove('shop-ai-dock-left', 'shop-ai-dock-right', 'shop-ai-origin-top', 'shop-ai-origin-bottom');
        container.classList.add(`shop-ai-position-${safePosition}`);
        container.classList.add(`shop-ai-dock-${dockSide}`);
        container.classList.add(`shop-ai-origin-${dockOrigin}`);
        container.dataset.shopAiPosition = safePosition;
      },

      /**
       * Apply the active storefront widget layout.
       * @param {HTMLElement} container - The main container element
       * @param {string} layout - Merchant widget layout
       */
      applyWidgetLayout: function(container, layout) {
        const safeLayout = this.normalizeLayout(layout);
        const supportedLayouts = ['bubble', 'side-panel', 'inline', 'fullscreen'];

        supportedLayouts.forEach((item) => {
          container.classList.remove(`shop-ai-layout-${item}`);
        });

        container.dataset.shopAiLayout = safeLayout;
        container.classList.add(`shop-ai-layout-${safeLayout}`);

        if (safeLayout === 'inline') {
          this.mountInlineWidget(container);
        }
      },

      normalizeLayout: function(layout) {
        const layoutMap = {
          'bubble-modal-fullscreen': 'bubble',
          'bubble_modal_fullscreen': 'bubble',
          'side_panel': 'side-panel',
          'side-panel': 'side-panel',
          'inline': 'inline',
          'fullscreen': 'fullscreen',
          'bubble': 'bubble'
        };

        return layoutMap[layout] || 'bubble';
      },

      mountInlineWidget: function(container) {
        if (container.dataset.shopAiInlineMounted === 'true') return;

        const target =
          document.querySelector('main .shopify-section') ||
          document.querySelector('#MainContent .shopify-section') ||
          document.querySelector('main') ||
          document.querySelector('#MainContent');

        if (target?.parentNode) {
          target.parentNode.insertBefore(container, target.nextSibling);
        }

        container.dataset.shopAiInlineMounted = 'true';
      },

      getWidgetBehavior: function() {
        return ShopAIChat.Config.getEffectiveConfig().widget?.behavior || {};
      },

      getWidgetLayout: function() {
        return this.normalizeLayout(ShopAIChat.Config.getEffectiveConfig().widget?.layout);
      },

      opensDirectly: function() {
        const behavior = this.getWidgetBehavior();
        if (behavior.entryBehavior === 'direct') return true;
        if (behavior.entryBehavior === 'choice') return false;

        const layout = this.getWidgetLayout();
        return layout === 'side-panel' || layout === 'fullscreen';
      },

      applyInitialWidgetBehavior: function() {
        const behavior = this.getWidgetBehavior();
        const layout = this.getWidgetLayout();

        if (layout === 'inline' && behavior.entryBehavior === 'direct') {
          window.setTimeout(() => this.openChatMode(false), 250);
          return;
        }

        if (layout === 'inline' && !behavior.openOnLoad) {
          this.openChoicePanel();
          return;
        }

        if (behavior.openOnLoad) {
          window.setTimeout(() => this.openChatMode(false), 600);
        }
      },

      /**
       * Render merchant quick actions into the existing suggestion row.
       * @param {Array<string>} quickActions - Merchant quick action labels
       * @param {Object} behavior - Widget behavior settings
       */
      renderQuickActions: function(quickActions, behavior) {
        const { suggestionsContainer } = this.elements;
        if (!suggestionsContainer) return;

        if (behavior?.showQuickActions === false) {
          suggestionsContainer.hidden = true;
          this.elements.promptButtons = [];
          return;
        }

        const actions = Array.isArray(quickActions) && quickActions.length > 0
          ? quickActions
          : ShopAIChat.Config.defaults.assistant.quickActions;

        suggestionsContainer.hidden = false;
        suggestionsContainer.replaceChildren();

        actions.forEach((label) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.shopAiPrompt = ShopAIChat.Config.getQuickActionPrompt(label);
          button.textContent = label;
          suggestionsContainer.appendChild(button);
        });

        this.elements.promptButtons = suggestionsContainer.querySelectorAll('[data-shop-ai-prompt]');
      },

      /**
       * Setup mobile-specific viewport adjustments
       */
      setupMobileViewport: function() {
        const setViewportHeight = () => {
          document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
        };
        window.addEventListener('resize', setViewportHeight);
        setViewportHeight();
      },

      /**
       * Open the initial shopping choice panel
       */
      openChoicePanel: function() {
        const { container, chatBubble, choicePanel, chatWindow } = this.elements;
        const layout = this.getWidgetLayout();

        if (!choicePanel) {
          this.openChatMode();
          return;
        }

        if (chatWindow?.classList.contains('active')) {
          this.closeChatWindow();
          return;
        }

        choicePanel.classList.add('active');
        choicePanel.setAttribute('aria-hidden', 'false');
        chatWindow?.setAttribute('aria-hidden', 'true');
        chatBubble?.setAttribute('aria-expanded', 'true');
        container?.classList.add('shop-ai-choice-active');
        container?.classList.remove('shop-ai-chat-active');

        if (layout === 'inline') {
          document.body.classList.remove('shop-ai-chat-open');
        }
      },

      /**
       * Close the initial shopping choice panel
       */
      closeChoicePanel: function() {
        const { container, chatBubble, choicePanel, chatWindow } = this.elements;
        if (!choicePanel) return;

        choicePanel.classList.remove('active');
        choicePanel.setAttribute('aria-hidden', 'true');
        container?.classList.remove('shop-ai-choice-active');

        if (!chatWindow?.classList.contains('active')) {
          chatBubble?.setAttribute('aria-expanded', 'false');
        }
      },

      /**
       * Open the full chat buying mode
       */
      openChatMode: function(shouldFocus = true) {
        const { container, chatBubble, chatWindow, chatInput } = this.elements;

        this.closeChoicePanel();
        chatWindow.classList.add('active');
        chatWindow.setAttribute('aria-hidden', 'false');
        chatBubble?.setAttribute('aria-expanded', 'true');
        container?.classList.add('shop-ai-chat-active');

        if (this.getWidgetLayout() === 'fullscreen' || this.isMobile) {
          document.body.classList.add('shop-ai-chat-open');
        }

        if (shouldFocus && this.isMobile) {
          setTimeout(() => chatInput?.focus(), 500);
        } else if (shouldFocus) {
          chatInput?.focus();
        }

        this.scrollToBottom();
      },

      /**
       * Close chat window
       */
      closeChatWindow: function() {
        const { container, chatBubble, chatWindow, chatInput } = this.elements;

        chatWindow.classList.remove('active');
        chatWindow.setAttribute('aria-hidden', 'true');
        chatBubble?.setAttribute('aria-expanded', 'false');
        container?.classList.remove('shop-ai-chat-active');
        document.body.classList.remove('shop-ai-chat-open');

        if (this.getWidgetLayout() === 'inline') {
          this.openChoicePanel();
        }

        // On mobile, blur input to hide keyboard and enable body scrolling
        if (this.isMobile) {
          chatInput?.blur();
        }

        if (this.getWidgetLayout() !== 'inline') {
          window.setTimeout(() => {
            (this.lastFocusedElement || chatBubble)?.focus();
          }, 0);
        }
      },

      /**
       * Scroll messages container to bottom
       */
      scrollToBottom: function() {
        const { messagesContainer } = this.elements;
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
      },

      /**
       * Show typing indicator in the chat
       */
      showTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = document.createElement('div');
        typingIndicator.classList.add('shop-ai-typing-indicator');
        for (let index = 0; index < 3; index += 1) {
          typingIndicator.appendChild(document.createElement('span'));
        }
        messagesContainer.appendChild(typingIndicator);
        this.scrollToBottom();
      },

      /**
       * Remove typing indicator from the chat
       */
      removeTypingIndicator: function() {
        const { messagesContainer } = this.elements;

        const typingIndicator = messagesContainer.querySelector('.shop-ai-typing-indicator');
        if (typingIndicator) {
          typingIndicator.remove();
        }
      },

      /**
       * Display product results in the chat
       * @param {Array} products - Array of product data objects
       */
      displayProductResults: function(products) {
        const { messagesContainer } = this.elements;

        // Create a wrapper for the product section
        const productSection = document.createElement('div');
        productSection.classList.add('shop-ai-product-section');
        messagesContainer.appendChild(productSection);

        // Add a header for the product results
        const header = document.createElement('div');
        header.classList.add('shop-ai-product-header');
        const heading = document.createElement('h4');
        heading.textContent = 'Recommended from the catalog';
        header.appendChild(heading);
        productSection.appendChild(header);

        // Create the product grid container
        const productsContainer = document.createElement('div');
        productsContainer.classList.add('shop-ai-product-grid');
        productSection.appendChild(productsContainer);

        if (!products || !Array.isArray(products) || products.length === 0) {
          const noProductsMessage = document.createElement('p');
          noProductsMessage.textContent = "No products found";
          noProductsMessage.style.padding = "10px";
          productsContainer.appendChild(noProductsMessage);
        } else {
          products.forEach(product => {
            const productCard = ShopAIChat.Product.createCard(product);
            productsContainer.appendChild(productCard);
          });
        }

        this.scrollToBottom();
      }
    },

    /**
     * Message handling and display functionality
     */
    Message: {
      /**
       * Send a message to the API
       * @param {HTMLInputElement} chatInput - The input element
       * @param {HTMLElement} messagesContainer - The messages container
       */
      send: async function(chatInput, messagesContainer) {
        const userMessage = chatInput.value.trim();
        const conversationId = sessionStorage.getItem('shopAiConversationId');

        messagesContainer.classList.add('shop-ai-conversation-started');

        // Add user message to chat
        this.add(userMessage, 'user', messagesContainer);

        // Clear input
        chatInput.value = '';
        ShopAIChat.UI.updateSendState();

        // Show typing indicator
        ShopAIChat.UI.showTypingIndicator();

        try {
          await ShopAIChat.API.streamResponse(userMessage, conversationId, messagesContainer);
        } catch (error) {
          console.error('Error communicating with Claude API:', error);
          ShopAIChat.UI.removeTypingIndicator();
          this.add("Sorry, I couldn't process your request at the moment. Please try again later.", 'assistant', messagesContainer);
        }
      },

      /**
       * Add a message to the chat
       * @param {string} text - Message content
       * @param {string} sender - Message sender ('user' or 'assistant')
       * @param {HTMLElement} messagesContainer - The messages container
       * @returns {HTMLElement} The created message element
       */
      add: function(text, sender, messagesContainer) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('shop-ai-message', sender);

        if (sender === 'assistant') {
          messageElement.dataset.rawText = text;
          ShopAIChat.Formatting.formatMessageContent(messageElement);
        } else {
          messageElement.textContent = text;
        }

        messagesContainer.appendChild(messageElement);
        ShopAIChat.UI.scrollToBottom();

        return messageElement;
      },

      /**
       * Show shopper-facing progress without exposing tool names or arguments.
       * @param {string} toolMessage - Internal tool event from the stream
       * @param {HTMLElement} messagesContainer - The messages container
       */
      addProgress: function(toolMessage, messagesContainer) {
        const match = toolMessage.match(/Calling tool: ([\w-]+)/);
        const toolName = match?.[1] || '';
        const labels = {
          search_catalog: 'Searching the Shopify catalog',
          search_shop_catalog: 'Searching the Shopify catalog',
          search_shop_policies_and_faqs: 'Checking store information',
          get_cart: 'Checking your Shopify cart',
          update_cart: 'Updating your Shopify cart'
        };
        const progressElement = document.createElement('div');
        progressElement.classList.add('shop-ai-progress-message');
        progressElement.textContent = labels[toolName] || 'Checking the store';

        messagesContainer.appendChild(progressElement);
        ShopAIChat.UI.scrollToBottom();
      }
    },

    /**
     * Text formatting and markdown handling
     */
    Formatting: {
      /**
       * Format message content with markdown and links
       * @param {HTMLElement} element - The element to format
       */
      formatMessageContent: function(element) {
        if (!element || !element.dataset.rawText) return;
        element.replaceChildren(this.buildSafeFragment(element.dataset.rawText));
      },

      /**
       * Render the small supported Markdown subset without HTML parsing.
       * @param {string} text - Markdown text to convert
       * @returns {DocumentFragment} Safe message content
       */
      buildSafeFragment: function(text) {
        const fragment = document.createDocumentFragment();
        const lines = text.split('\n');
        let currentList = null;
        for (const line of lines) {
          const unorderedMatch = line.match(/^\s*([-*])\s+(.*)/);
          const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.*)/);

          if (unorderedMatch) {
            if (!currentList || currentList.tagName !== 'UL') {
              currentList = document.createElement('ul');
              fragment.appendChild(currentList);
            }
            const item = document.createElement('li');
            this.appendInlineContent(item, unorderedMatch[2]);
            currentList.appendChild(item);
          } else if (orderedMatch) {
            if (!currentList || currentList.tagName !== 'OL') {
              currentList = document.createElement('ol');
              currentList.start = Number.parseInt(orderedMatch[1], 10);
              fragment.appendChild(currentList);
            }
            const item = document.createElement('li');
            this.appendInlineContent(item, orderedMatch[2]);
            currentList.appendChild(item);
          } else {
            currentList = null;
            if (line.trim() === '') {
              fragment.appendChild(document.createElement('br'));
            } else {
              const paragraph = document.createElement('p');
              this.appendInlineContent(paragraph, line);
              fragment.appendChild(paragraph);
            }
          }
        }
        return fragment;
      },

      appendInlineContent: function(parent, text) {
        const tokenPattern = /(\[([^\]]+)\]\(([^)\s]+)\)|(\*\*|__)(.*?)\4)/g;
        let cursor = 0;
        let match;
        while ((match = tokenPattern.exec(text)) !== null) {
          if (match.index > cursor) {
            parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
          }
          if (match[2] !== undefined) {
            this.appendSafeLink(parent, match[2], match[3]);
          } else {
            const strong = document.createElement('strong');
            strong.textContent = match[5] || '';
            parent.appendChild(strong);
          }
          cursor = match.index + match[0].length;
        }
        if (cursor < text.length) {
          parent.appendChild(document.createTextNode(text.slice(cursor)));
        }
      },

      appendSafeLink: function(parent, label, rawUrl) {
        const url = this.safeHttpUrl(rawUrl);
        if (!url) {
          parent.appendChild(document.createTextNode(label));
          return;
        }

        const link = document.createElement('a');
        const isAuth = this.isTrustedAuthUrl(url);
        if (isAuth) {
          window.shopAuthUrl = url.toString();
          link.href = '#auth';
          link.classList.add('shop-auth-trigger');
        } else {
          link.href = url.toString();
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        link.textContent = url.pathname.includes('/cart') || url.pathname.includes('checkout')
          ? 'click here to proceed to checkout'
          : label;
        parent.appendChild(link);
      },

      safeHttpUrl: function(value) {
        try {
          const url = new URL(value, window.location.origin);
          const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
          return url.protocol === 'https:' || (url.protocol === 'http:' && isLocal) ? url : null;
        } catch (_error) {
          return null;
        }
      },

      safeProductUrl: function(value) {
        const url = this.safeHttpUrl(value);
        if (!url || !this.isCurrentShopHost(url.hostname)) return null;
        return url;
      },

      safeImageUrl: function(value) {
        const url = this.safeHttpUrl(value);
        if (!url) return null;
        const host = url.hostname.toLowerCase();
        return this.isCurrentShopHost(host) ||
          host === 'cdn.shopify.com' ||
          host.endsWith('.shopifycdn.net')
          ? url
          : null;
      },

      safeCheckoutUrl: function(value) {
        const url = this.safeHttpUrl(value);
        if (!url || !this.isCurrentShopHost(url.hostname)) return null;
        const path = url.pathname.toLowerCase();
        return path.includes('checkout') || path.startsWith('/cart/c/') ? url : null;
      },

      isCurrentShopHost: function(hostname) {
        const host = String(hostname || '').toLowerCase();
        const canonical = ShopAIChat.API.bootstrapData?.shop?.domain?.toLowerCase();
        let storefrontHost = window.location.hostname.toLowerCase();
        try {
          storefrontHost = new URL(
            ShopAIChat.API.bootstrapData?.shop?.storefrontOrigin || window.location.origin
          ).hostname.toLowerCase();
        } catch (_error) {
          // The current storefront hostname remains the safe fallback.
        }
        return host === storefrontHost || host === canonical;
      },

      isTrustedAuthUrl: function(url) {
        const host = url.hostname.toLowerCase();
        const shopDomain = ShopAIChat.API.bootstrapData?.shop?.domain?.toLowerCase() || '';
        const accountHost = shopDomain.replace(/\.myshopify\.com$/, '.account.myshopify.com');
        const trustedHost = host === 'shopify.com' || host.endsWith('.shopify.com') || host === accountHost;
        return trustedHost && (url.pathname.includes('oauth') || url.pathname.includes('authentication'));
      }
    },

    /**
     * API communication and data handling
     */
    API: {
      bootstrapData: null,

      ensureBootstrap: async function(force = false) {
        const expiresAt = this.bootstrapData?.expiresAt
          ? new Date(this.bootstrapData.expiresAt).getTime()
          : 0;
        if (!force && this.bootstrapData?.token && expiresAt > Date.now() + 30_000) {
          return this.bootstrapData;
        }

        const configuredBaseUrl = window.shopChatConfig?.backendUrl?.trim();
        const appProxyBaseUrl = configuredBaseUrl?.startsWith('/') && configuredBaseUrl !== '/'
          ? this.getBackendBaseUrl()
          : '/apps/intentcart';
        const response = await fetch(`${appProxyBaseUrl}/bootstrap`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (!response.ok) throw new Error(`Widget bootstrap failed with ${response.status}`);
        const payload = await response.json();
        if (!payload?.token || !payload?.config) throw new Error('Widget bootstrap response is invalid');
        this.bootstrapData = payload;
        return payload;
      },

      /**
       * Get the configured backend base URL.
       * Supports absolute app dev tunnel URLs and same-origin app proxy paths.
       * @returns {string} Backend base URL without trailing slash
       */
      getBackendBaseUrl: function() {
        const configuredUrl = window.shopChatConfig?.backendUrl?.trim();
        if (!configuredUrl || configuredUrl === '/') return '/apps/intentcart';

        try {
          const url = new URL(configuredUrl, window.location.origin);
          const isLocalDev = ['localhost', '127.0.0.1'].includes(url.hostname);
          if (url.protocol !== 'https:' && !isLocalDev) return '/apps/intentcart';
          return url.toString().replace(/\/+$/, '');
        } catch (_error) {
          return '/apps/intentcart';
        }
      },

      /**
       * Build a backend URL for chat and auth endpoints.
       * @param {string} path - Endpoint path beginning with /
       * @returns {string} Resolved backend URL
       */
      buildBackendUrl: function(path) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const backendBaseUrl = this.getBackendBaseUrl();

        return `${backendBaseUrl}${normalizedPath}`;
      },

      getAuthorizedHeaders: function(additionalHeaders = {}) {
        return {
          ...additionalHeaders,
          ...(this.bootstrapData?.token
            ? { 'Authorization': `Bearer ${this.bootstrapData.token}` }
            : {})
        };
      },

      authorizedFetch: async function(url, options = {}, retry = true) {
        await this.ensureBootstrap();
        const response = await fetch(url, {
          ...options,
          headers: this.getAuthorizedHeaders(options.headers || {})
        });
        if (response.status !== 401 || !retry) return response;

        await this.ensureBootstrap(true);
        return fetch(url, {
          ...options,
          headers: this.getAuthorizedHeaders(options.headers || {})
        });
      },

      getVisitorId: function() {
        let visitorId = sessionStorage.getItem('shopAiVisitorId');
        if (!visitorId) {
          visitorId = crypto.randomUUID();
          sessionStorage.setItem('shopAiVisitorId', visitorId);
        }
        return visitorId;
      },

      /**
       * Stream a response from the API
       * @param {string} userMessage - User's message text
       * @param {string} conversationId - Conversation ID for context
       * @param {HTMLElement} messagesContainer - The messages container
       */
      streamResponse: async function(userMessage, conversationId, messagesContainer) {
        let currentMessageElement = null;

        try {
          await this.ensureBootstrap();
          const promptType = window.shopChatConfig?.promptType || "standardAssistant";
          const requestBody = JSON.stringify({
            message: userMessage,
            conversation_id: conversationId,
            visitor_id: this.getVisitorId(),
            prompt_type: promptType
          });

          const streamUrl = this.buildBackendUrl('/chat');

          const response = await this.authorizedFetch(streamUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            },
            body: requestBody
          });

          if (!response.ok) {
            throw new Error(`Chat request failed with ${response.status} ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('Chat request did not return a readable stream');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let receivedStreamEvent = false;

          // Create initial message element
          let messageElement = document.createElement('div');
          messageElement.classList.add('shop-ai-message', 'assistant');
          messageElement.textContent = '';
          messageElement.dataset.rawText = '';
          messagesContainer.appendChild(messageElement);
          currentMessageElement = messageElement;

          // Process the stream
          let streamDone = false;
          while (!streamDone) {
            const { value, done } = await reader.read();
            if (done) {
              streamDone = true;
              continue;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  receivedStreamEvent = true;
                  this.handleStreamEvent(data, currentMessageElement, messagesContainer, userMessage,
                    (newElement) => { currentMessageElement = newElement; });
                } catch (e) {
                  console.error('Error parsing event data:', e, line);
                }
              }
            }
          }

          if (!receivedStreamEvent) {
            throw new Error('Chat stream closed without SSE events');
          }

          ShopAIChat.UI.removeTypingIndicator();
        } catch (error) {
          console.error('Error in streaming:', error);
          ShopAIChat.UI.removeTypingIndicator();
          ShopAIChat.Message.add("Sorry, I couldn't process your request. Please try again later.",
            'assistant', messagesContainer);
        }
      },

      /**
       * Handle stream events from the API
       * @param {Object} data - Event data
       * @param {HTMLElement} currentMessageElement - Current message element being updated
       * @param {HTMLElement} messagesContainer - The messages container
       * @param {string} userMessage - The original user message
       * @param {Function} updateCurrentElement - Callback to update the current element reference
       */
      handleStreamEvent: function(data, currentMessageElement, messagesContainer, userMessage, updateCurrentElement) {
        switch (data.type) {
          case 'id':
            if (data.conversation_id) {
              sessionStorage.setItem('shopAiConversationId', data.conversation_id);
            }
            break;

          case 'chunk':
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.dataset.rawText += data.chunk;
            currentMessageElement.textContent = currentMessageElement.dataset.rawText;
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'message_complete':
            ShopAIChat.UI.removeTypingIndicator();
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
            ShopAIChat.UI.scrollToBottom();
            break;

          case 'end_turn':
            ShopAIChat.UI.removeTypingIndicator();
            break;

          case 'error':
            console.error('Stream error:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = "Sorry, I couldn't process your request. Please try again later.";
            break;

          case 'rate_limit_exceeded':
            console.error('Rate limit exceeded:', data.error);
            ShopAIChat.UI.removeTypingIndicator();
            currentMessageElement.textContent = "Sorry, our servers are currently busy. Please try again later.";
            break;

          case 'auth_required':
            // Save the last user message for resuming after authentication
            sessionStorage.setItem('shopAiLastMessage', userMessage || '');
            {
              const authUrl = ShopAIChat.Formatting.safeHttpUrl(data.authorization_url);
              if (authUrl && ShopAIChat.Formatting.isTrustedAuthUrl(authUrl)) {
                ShopAIChat.Auth.openAuthPopup(authUrl.toString());
              }
            }
            break;

          case 'product_results':
            ShopAIChat.UI.displayProductResults(data.products);
            break;

          case 'cart_state':
            {
              const checkoutUrl = ShopAIChat.Formatting.safeCheckoutUrl(data.checkoutUrl);
              if (!checkoutUrl) break;
              ShopAIChat.Message.add(
                `Your cart is ready. You can [click here to proceed to checkout](${checkoutUrl.toString()}).`,
                'assistant',
                messagesContainer
              );
            }
            break;

          case 'tool_use':
            if (data.tool_use_message) {
              ShopAIChat.Message.addProgress(data.tool_use_message, messagesContainer);
            }
            break;

          case 'new_message': {
            ShopAIChat.Formatting.formatMessageContent(currentMessageElement);
            ShopAIChat.UI.showTypingIndicator();

            // Create new message element for the next response
            const newMessageElement = document.createElement('div');
            newMessageElement.classList.add('shop-ai-message', 'assistant');
            newMessageElement.textContent = '';
            newMessageElement.dataset.rawText = '';
            messagesContainer.appendChild(newMessageElement);

            // Update the current element reference
            updateCurrentElement(newMessageElement);
            break;
          }

          case 'content_block_complete':
            ShopAIChat.UI.showTypingIndicator();
            break;
        }
      },

      /**
       * Fetch chat history from the server
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      fetchChatHistory: async function(conversationId, messagesContainer) {
        try {
          await this.ensureBootstrap();
          // Show a loading message
          const loadingMessage = document.createElement('div');
          loadingMessage.classList.add('shop-ai-message', 'assistant');
          loadingMessage.textContent = "Loading conversation history...";
          messagesContainer.appendChild(loadingMessage);

          // Fetch history from the server
          const historyUrl = this.buildBackendUrl(`/chat?history=true&conversation_id=${encodeURIComponent(conversationId)}`);
          const response = await this.authorizedFetch(historyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            mode: 'cors'
          });

          if (!response.ok) {
            console.error('History fetch failed:', response.status, response.statusText);
            throw new Error('Failed to fetch chat history: ' + response.status);
          }

          const data = await response.json();

          // Remove loading message
          messagesContainer.removeChild(loadingMessage);

          // No messages, show welcome message
          if (!data.messages || data.messages.length === 0) {
            const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
            ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);
            return;
          }

          messagesContainer.classList.add('shop-ai-conversation-started');

          // Add messages to the UI - filter out tool results
          data.messages.forEach(message => {
            try {
              const messageContents = JSON.parse(message.content);
              for (const contentBlock of messageContents) {
                if (contentBlock.type === 'text') {
                  ShopAIChat.Message.add(contentBlock.text, message.role, messagesContainer);
                }
              }
            } catch (e) {
              ShopAIChat.Message.add(message.content, message.role, messagesContainer);
            }
          });

          // Scroll to bottom
          ShopAIChat.UI.scrollToBottom();

        } catch (error) {
          console.error('Error fetching chat history:', error);

          // Remove loading message if it exists
          const loadingMessage = messagesContainer.querySelector('.shop-ai-message.assistant');
          if (loadingMessage && loadingMessage.textContent === "Loading conversation history...") {
            messagesContainer.removeChild(loadingMessage);
          }

          // Show error and welcome message
          const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
          ShopAIChat.Message.add(welcomeMessage, 'assistant', messagesContainer);

          // Clear the conversation ID since we couldn't fetch this conversation
          sessionStorage.removeItem('shopAiConversationId');
        }
      }
    },

    /**
     * Authentication-related functionality
     */
    Auth: {
      /**
       * Opens an authentication popup window
       * @param {string|HTMLElement} authUrlOrElement - The auth URL or link element that was clicked
       */
      openAuthPopup: function(authUrlOrElement) {
        let authUrl;
        if (typeof authUrlOrElement === 'string') {
          // If a string URL was passed directly
          authUrl = authUrlOrElement;
        } else {
          // If an element was passed
          authUrl = authUrlOrElement.getAttribute('data-auth-url');
          if (!authUrl) {
            console.error('No auth URL found in element');
            return;
          }
        }

        const safeAuthUrl = ShopAIChat.Formatting.safeHttpUrl(authUrl);
        if (!safeAuthUrl || !ShopAIChat.Formatting.isTrustedAuthUrl(safeAuthUrl)) {
          console.error('Untrusted authentication URL rejected');
          return;
        }
        authUrl = safeAuthUrl.toString();

        // Open the popup window centered in the screen
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2 + window.screenX;
        const top = (window.innerHeight - height) / 2 + window.screenY;

        const popup = window.open(
          authUrl,
          'ShopifyAuth',
          `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        // Focus the popup window
        if (popup) {
          popup.focus();
        } else {
          // If popup was blocked, show a message
          alert('Please allow popups for this site to authenticate with Shopify.');
        }

        // Start polling for token availability
        const conversationId = sessionStorage.getItem('shopAiConversationId');
        if (conversationId) {
          const messagesContainer = document.querySelector('.shop-ai-chat-messages');

          // Add a message to indicate authentication is in progress
          ShopAIChat.Message.add("Authentication in progress. Please complete the process in the popup window.",
            'assistant', messagesContainer);

          this.startTokenPolling(conversationId, messagesContainer);
        }
      },

      /**
       * Start polling for token availability
       * @param {string} conversationId - Conversation ID
       * @param {HTMLElement} messagesContainer - The messages container
       */
      startTokenPolling: function(conversationId, messagesContainer) {
        if (!conversationId) return;

        const pollingId = 'polling_' + Date.now();
        sessionStorage.setItem('shopAiTokenPollingId', pollingId);

        let attemptCount = 0;
        const maxAttempts = 30;

        const poll = async () => {
          if (sessionStorage.getItem('shopAiTokenPollingId') !== pollingId) {
            return;
          }

          if (attemptCount >= maxAttempts) {
            return;
          }

          attemptCount++;

          try {
            await ShopAIChat.API.ensureBootstrap();
            const tokenUrl = ShopAIChat.API.buildBackendUrl(
              `/auth/token-status?conversation_id=${encodeURIComponent(conversationId)}`
            );
            const response = await ShopAIChat.API.authorizedFetch(tokenUrl, {
              headers: { 'Accept': 'application/json' },
              cache: 'no-store'
            });

            if (!response.ok) {
              throw new Error('Token status check failed: ' + response.status);
            }

            const data = await response.json();

            if (data.status === 'authorized') {
              const message = sessionStorage.getItem('shopAiLastMessage');

              if (message) {
                sessionStorage.removeItem('shopAiLastMessage');
                setTimeout(() => {
                  ShopAIChat.Message.add("Authorization successful! I'm now continuing with your request.",
                    'assistant', messagesContainer);
                  ShopAIChat.API.streamResponse(message, conversationId, messagesContainer);
                  ShopAIChat.UI.showTypingIndicator();
                }, 500);
              }

              sessionStorage.removeItem('shopAiTokenPollingId');
              return;
            }

            setTimeout(poll, 10000);
          } catch (error) {
            console.error('Error polling for token status:', error);
            setTimeout(poll, 10000);
          }
        };

        setTimeout(poll, 2000);
      }
    },

    /**
     * Product-related functionality
     */
    Product: {
      /**
       * Create a product card element
       * @param {Object} product - Product data
       * @returns {HTMLElement} Product card element
       */
      createCard: function(product) {
        const card = document.createElement('div');
        card.classList.add('shop-ai-product-card');

        // Create image container
        const imageContainer = document.createElement('div');
        imageContainer.classList.add('shop-ai-product-image');

        // Add product image or placeholder
        const image = document.createElement('img');
        const placeholderImage = 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
        const safeImageUrl = ShopAIChat.Formatting.safeImageUrl(product.image_url);
        image.src = safeImageUrl?.toString() || placeholderImage;
        image.alt = String(product.title || 'Product');
        image.onerror = function() {
          // If image fails to load, use a fallback placeholder
          this.src = placeholderImage;
        };
        imageContainer.appendChild(image);
        card.appendChild(imageContainer);

        // Add product info
        const info = document.createElement('div');
        info.classList.add('shop-ai-product-info');

        // Add product title
        const title = document.createElement('h3');
        title.classList.add('shop-ai-product-title');
        title.textContent = String(product.title || 'Product');

        // If product has a URL, make the title a link
        const safeProductUrl = ShopAIChat.Formatting.safeProductUrl(product.url);
        if (safeProductUrl) {
          const titleLink = document.createElement('a');
          titleLink.href = safeProductUrl.toString();
          titleLink.target = '_blank';
          titleLink.rel = 'noopener noreferrer';
          titleLink.textContent = String(product.title || 'Product');
          title.textContent = '';
          title.appendChild(titleLink);
        }

        info.appendChild(title);

        // Add product price
        const price = document.createElement('p');
        price.classList.add('shop-ai-product-price');
        price.textContent = String(product.price || '');
        info.appendChild(price);

        if (product.description) {
          const description = document.createElement('p');
          description.classList.add('shop-ai-product-description');
          description.textContent = String(product.description);
          info.appendChild(description);
        }

        const optionText = ShopAIChat.Product.formatOptions(product);
        if (optionText) {
          const options = document.createElement('p');
          options.classList.add('shop-ai-product-options');
          options.textContent = optionText;
          info.appendChild(options);
        }

        const availability = document.createElement('p');
        availability.classList.add('shop-ai-product-availability');
        availability.textContent = product.available === false ? 'Check availability' : 'Available in catalog';
        info.appendChild(availability);

        // Add add-to-cart button
        const button = document.createElement('button');
        button.classList.add('shop-ai-add-to-cart');
        button.textContent = 'Choose in chat';
        button.dataset.productId = product.id;

        // Add click handler for the button
        button.addEventListener('click', function() {
          // Send message to add this product to cart
          const input = document.querySelector('.shop-ai-chat-input input');
          if (input) {
            input.value = `I want ${product.title}. Confirm the best variant and add it to my cart.`;
            // Trigger a click on the send button
            const sendButton = document.querySelector('.shop-ai-chat-send');
            if (sendButton) {
              sendButton.click();
            }
          }
        });

        info.appendChild(button);
        card.appendChild(info);

        return card;
      },

      /**
       * Format product options and variants for compact product cards
       * @param {Object} product - Product data
       * @returns {string} Options summary
       */
      formatOptions: function(product) {
        if (Array.isArray(product.options) && product.options.length > 0) {
          return product.options
            .map((option) => {
              if (typeof option === 'string') return option;
              const values = Array.isArray(option.values)
                ? option.values.map(ShopAIChat.Product.formatOptionValue).filter(Boolean).join(', ')
                : '';
              return values ? `${option.name}: ${values}` : option.name;
            })
            .filter(Boolean)
            .join(' | ');
        }

        if (Array.isArray(product.variants) && product.variants.length > 0) {
          return `${product.variants.length} variant${product.variants.length > 1 ? 's' : ''} available`;
        }

        return '';
      },

      /**
       * Format a Shopify/UCP option value for display.
       * @param {string|number|Object} value - Option value
       * @returns {string} Display label
       */
      formatOptionValue: function(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value);

        return value.label || value.name || value.value || value.title || '';
      }
    },

    /**
     * Initialize the chat application
     */
    init: async function() {
      await this.Config.load();

      // Initialize UI
      const container = document.querySelector('.shop-ai-chat-container');
      if (!container) return;

      this.UI.init(container);

      // Check for existing conversation
      const conversationId = sessionStorage.getItem('shopAiConversationId');

      if (conversationId) {
        // Fetch conversation history
        this.API.fetchChatHistory(conversationId, this.UI.elements.messagesContainer);
      } else {
        // No previous conversation, show welcome message
        const welcomeMessage = window.shopChatConfig?.welcomeMessage || "👋 Hi there! How can I help you today?";
        this.Message.add(welcomeMessage, 'assistant', this.UI.elements.messagesContainer);
      }
    }
  };

  // Initialize the application when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    ShopAIChat.init().catch((error) => {
      console.error('[IntentCart] failed to initialize widget:', error);
    });
  });
})();
