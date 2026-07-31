/* eslint-env node */
process.env.NODE_ENV = "test";
process.env.WIDGET_SIGNING_SECRET ||= "widget-signing-secret-for-tests-1234567890";
process.env.TOKEN_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef";
process.env.SHOPIFY_API_SECRET ||= "shopify-api-secret-for-tests-123456789";
process.env.DATABASE_URL ||= "postgresql://intentcart:intentcart@localhost:5432/intentcart_test";
process.env.DIRECT_URL ||= process.env.DATABASE_URL;
