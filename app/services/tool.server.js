/**
 * Tool Service
 * Manages tool execution and processing
 */
import { saveMessage } from "../db.server";
import AppConfig from "./config.server";

/**
 * Creates a tool service instance
 * @returns {Object} Tool service with methods for managing tools
 */
export function createToolService() {
  /**
   * Handles a tool error response
   * @param {Object} toolUseResponse - The error response from the tool
   * @param {string} toolName - The name of the tool
   * @param {string} toolUseId - The ID of the tool use request
   * @param {Array} conversationHistory - The conversation history
   * @param {Function} sendMessage - Function to send messages to the client
   * @param {string} conversationId - The conversation ID
   */
  const handleToolError = async (toolUseResponse, toolName, toolUseId, conversationHistory, sendMessage, conversationId) => {
    if (toolUseResponse.error.type === "auth_required") {
      console.log("Auth required for tool:", toolName);
      await addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.error.data, conversationId);
      sendMessage({ type: 'auth_required' });
    } else {
      console.log("Tool use error", toolUseResponse.error);
      await addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.error.data, conversationId);
    }
  };

  /**
   * Handles a successful tool response
   * @param {Object} toolUseResponse - The response from the tool
   * @param {string} toolName - The name of the tool
   * @param {string} toolUseId - The ID of the tool use request
   * @param {Array} conversationHistory - The conversation history
   * @param {Array} productsToDisplay - Array to add product results to
   * @param {string} conversationId - The conversation ID
   */
  const handleToolSuccess = async (toolUseResponse, toolName, toolUseId, conversationHistory, productsToDisplay, conversationId) => {
    // Check if this is a product search result
    if (toolName === AppConfig.tools.productSearchName) {
      productsToDisplay.push(...processProductSearchResult(toolUseResponse));
    }

    addToolResultToHistory(conversationHistory, toolUseId, toolUseResponse.content, conversationId);
  };

  /**
   * Processes product search results
   * @param {Object} toolUseResponse - The response from the tool
   * @returns {Array} Processed product data
   */
  const processProductSearchResult = (toolUseResponse) => {
    try {
      console.log("Processing product search result");
      let products = [];

      if (toolUseResponse.content && toolUseResponse.content.length > 0) {
        const content = toolUseResponse.content[0].text;

        try {
          let responseData;
          if (typeof content === 'object') {
            responseData = content;
          } else if (typeof content === 'string') {
            responseData = JSON.parse(content);
          }

          if (responseData?.products && Array.isArray(responseData.products)) {
            products = responseData.products
              .slice(0, AppConfig.tools.maxProductsToDisplay)
              .map(formatProductData);

            console.log(`Found ${products.length} products to display`);
          }
        } catch (e) {
          console.error("Error parsing product data:", e);
        }
      }

      return products;
    } catch (error) {
      console.error("Error processing product search results:", error);
      return [];
    }
  };

  /**
   * Formats a product data object
   * @param {Object} product - Raw product data
   * @returns {Object} Formatted product data
   */
  const formatProductData = (product) => {
    const variants = Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
          id: variant.id || variant.variant_id || '',
          title: variant.title || variant.name || '',
          price: formatMoney(variant.price),
          currency: variant.currency || variant.price?.currency || product.price_range?.min?.currency || '',
          available: variant.available ?? variant.available_for_sale ?? variant.availability?.available ?? null,
          selected_options: normalizeSelectedOptions(variant.selected_options || variant.options || [])
        }))
      : [];

    const price = product.price_range
      ? formatMoney(product.price_range.min)
      : (variants.length > 0
        ? variants[0].price
        : 'Price not available');

    return {
      id: product.product_id || product.id || `product-${Math.random().toString(36).substring(7)}`,
      product_id: product.product_id || product.id || '',
      title: product.title || 'Product',
      price: price,
      price_range: product.price_range || null,
      image_url: product.image_url || product.media?.[0]?.url || '',
      description: getDescriptionText(product.description),
      url: product.url || '',
      options: normalizeProductOptions(product.options || []),
      variants,
      available: product.available ?? product.available_for_sale ?? variants.some((variant) => variant.available === true),
      rating: product.rating || null,
      tags: product.tags || []
    };
  };

  const normalizeProductOptions = (options) => {
    if (!Array.isArray(options)) return [];

    return options
      .map((option) => {
        if (typeof option === 'string') {
          return {
            name: 'Option',
            values: [option]
          };
        }

        const values = Array.isArray(option?.values)
          ? option.values.map(formatOptionValue).filter(Boolean)
          : [];

        return {
          name: formatOptionValue(option?.name) || 'Option',
          values
        };
      })
      .filter((option) => option.name || option.values.length > 0);
  };

  const normalizeSelectedOptions = (options) => {
    if (!Array.isArray(options)) return [];

    return options
      .map((option) => {
        if (typeof option === 'string') return option;

        const name = formatOptionValue(option?.name) || 'Option';
        const value = formatOptionValue(option?.label || option?.value || option?.name || option);

        return value ? `${name}: ${value}` : name;
      })
      .filter(Boolean);
  };

  const formatOptionValue = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return value.label || value.name || value.value || value.title || '';
  };

  const formatMoney = (money) => {
    if (!money) return '';

    if (typeof money === 'string') return money;
    if (typeof money === 'number') return String(money);

    const amount = money.amount;
    const currency = money.currency || '';

    if (amount === undefined || amount === null) return '';

    const numericAmount = Number(amount);
    const displayAmount = Number.isFinite(numericAmount)
      ? (numericAmount / 100).toFixed(2)
      : String(amount);

    return `${currency} ${displayAmount}`.trim();
  };

  const getDescriptionText = (description) => {
    if (!description) return '';
    if (typeof description === 'string') return description;
    return description.html || description.text || '';
  };

  /**
   * Adds a tool result to the conversation history
   * @param {Array} conversationHistory - The conversation history
   * @param {string} toolUseId - The ID of the tool use request
   * @param {string} content - The content of the tool result
   * @param {string} conversationId - The conversation ID
   */
  const addToolResultToHistory = async (conversationHistory, toolUseId, content, conversationId) => {
    const toolResultMessage = {
      role: 'user',
      content: [{
        type: "tool_result",
        tool_use_id: toolUseId,
        content: content
      }]
    };

    // Add to in-memory history
    conversationHistory.push(toolResultMessage);

    // Save to database with special format to indicate tool result
    if (conversationId) {
      try {
        await saveMessage(conversationId, 'user', JSON.stringify(toolResultMessage.content));
      } catch (error) {
        console.error('Error saving tool result to database:', error);
      }
    }
  };

  return {
    handleToolError,
    handleToolSuccess,
    processProductSearchResult,
    addToolResultToHistory
  };
}

export default {
  createToolService
};
