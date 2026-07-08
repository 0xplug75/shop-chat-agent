# IntentCart Design System

## Purpose

IntentCart needs a product design system, not a marketing-site design system.

The app lives in two surfaces:

- The Shopify embedded app, where merchants configure and monitor the assistant.
- The Shopify storefront widget, where shoppers interact with Sage.

Both surfaces should feel premium, simple, commerce-focused, and Shopify-native. The interface should help a merchant understand what is live, what can be changed, and what needs attention without exposing runtime concepts.

---

## Design Principles

### Merchant-first language

Use merchant language, not runtime language.

Use:
- Assistant
- Widget
- Catalog
- Checkout
- Knowledge
- Rules
- Connected apps
- Performance

Avoid merchant-facing terms such as:
- MCP
- UCP
- Runtime
- Commerce Session
- Agent Orchestrator
- Tool calling
- Prompt engineering

### Operational before decorative

The embedded app is a control center. Every section should answer one of these questions:

- Is the assistant live?
- Is the widget active?
- Is the catalog connected?
- What does the shopper see?
- What can the assistant do?
- What remains to configure?

Avoid large marketing heroes, abstract architecture cards, and fake metrics.

### Shopify-native, IntentCart-owned

The app should fit inside Shopify Admin while still feeling like IntentCart.

Use Shopify-like density, simple cards, clear status labels, and restrained visual styling. IntentCart can own the accent color, widget preview, and assistant brand moments, but the admin surface should not fight the Shopify shell.

### Commerce stays factual

Visual design must reinforce that IntentCart uses Shopify as the source of truth.

Never design UI that implies the assistant owns product, inventory, price, cart, checkout, policy, or order truth.

---

## Surfaces

### Shopify Embedded App

Purpose:
- Merchant control center.
- Shows setup status.
- Explains assistant, widget, knowledge, and commerce behavior.
- Later becomes editable Merchant OS.

Current maturity:
- Read-only dashboard.
- Status summary and widget experience foundation.

Design direction:
- Light surface.
- Dense but readable.
- Cards with 8-10px radius.
- Green only for active/ready states.
- Primary accent for active widget mode and assistant brand highlights.
- No fake analytics.

### Theme Editor Settings

Purpose:
- Fast visual overrides for the storefront widget.
- Immediate merchant/designer control over placement and appearance.

Belongs here:
- Widget type.
- Position.
- Accent/background/text colors.
- Welcome message.
- Primary button label.
- Open automatically.
- Show quick actions.
- Entry behavior: auto, choice card, or direct chat.
- Backend URL only while development still depends on Shopify CLI tunnels or app proxy setup.

Does not belong here long term:
- Raw system prompts.
- Commerce rules.
- Knowledge sources.
- Integrations.
- Analytics.

### Storefront Widget

Purpose:
- Shopper-facing AI shopping entry point.
- Lets a shopper choose chat, describe intent, receive recommendations, select products, and move toward checkout.

Supported widget types:
- Bubble: default floating launcher.
- Side panel: guided assistant while browsing.
- Inline section: assistant in the page flow.
- Fullscreen: direct AI shopping mode.

The widget should feel clear, fast, and trustworthy. It should not look like a support bot unless the merchant chooses that positioning later.

---

## Visual Tokens

### Color

Core:
- `ink`: `#111827`
- `surface`: `#ffffff`
- `surface-muted`: `#f7f8fb`
- `border`: `#dedfe4`
- `text-muted`: `#69707d`

IntentCart accent:
- `primary`: `#4f46e5`
- `primary-soft`: `#eef0ff`
- `accent`: `#a78bfa`

State:
- `success`: `#25d366`
- `success-bg`: `#e8f8ef`
- `warning`: `#b7791f`
- `warning-bg`: `#fff7e6`
- `danger`: `#d72c0d`
- `danger-bg`: `#fff4f4`

Usage:
- Use primary for active widget mode, main chat actions, and assistant highlights.
- Use success only for real ready/live states.
- Do not use green as a general brand color in the dashboard.
- Avoid heavy gradients and decorative blobs.

### Typography

Use system/UI typography inside the Shopify embedded app.

Recommended stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Dashboard hierarchy:
- Page title: 28-36px, 700.
- Section title: 20-24px, 700.
- Card title: 16-20px, 700.
- Body: 14-16px, 400-500.
- Eyebrow/status: 12px, 700, uppercase only when useful.

Storefront widget:
- Match Shopify storefront expectations.
- Keep chat body readable at 14-16px.
- Avoid oversized hero typography inside widget panels.

### Shape

Dashboard:
- Cards: 8-10px radius.
- Panels: 10px radius.
- Inputs/previews: 8-10px radius.
- Status pills: 999px radius.

Widget:
- Bubble: circular.
- Choice panel: 12-16px radius.
- Side panel: 0 radius on screen edge.
- Inline section: 12-16px radius.
- Product cards: 8-10px radius.

Buttons:
- Primary CTAs can be pill or 8-10px depending on surface.
- Icon-only buttons should use familiar symbols.
- Do not use decorative rounded rectangles where a clear button or icon would be better.

---

## Embedded App Information Architecture

Current sections:

### Home

Goal:
- Show whether the assistant is ready.
- Summarize what shoppers can do today.

Required blocks:
- Assistant live.
- Widget active.
- Catalog connected.
- Checkout ready.
- Current setup summary.

### Assistant

Goal:
- Explain how Sage speaks and what guardrails exist.

Fields:
- Name.
- Personality.
- Brand voice.
- Welcome message.
- Quick actions.
- Guardrails.

### Widget

Goal:
- Show how the assistant appears on the storefront.

Fields:
- Widget type.
- Position.
- Entry behavior.
- Open on load.
- Quick actions.
- Visual preview.
- Supported modes.

### Knowledge

Goal:
- Show what Sage can answer from.

Active:
- Shopify product catalog.
- Store policies and FAQs.

Future:
- Documents.
- Help center.
- Custom knowledge.

### Commerce

Goal:
- Show how buying actions are controlled.

Fields:
- Max recommendations.
- Bundle strategy.
- Out-of-stock policy.
- Availability preference.
- Cart confirmation.
- Checkout handoff.

---

## Widget Experience

### Bubble

Use when:
- Default storefront install.
- Merchant wants a familiar low-friction launcher.

Behavior:
- Bubble opens choice panel.
- Shopper selects chat mode.
- Chat opens in large modal.
- Merchant can override entry behavior to direct chat when needed.

### Side Panel

Use when:
- Merchant wants guided browsing without fully covering the page.
- Product comparison matters.

Behavior:
- Bubble opens the chat directly.
- Panel slides from the right.
- Product cards remain inside chat.
- Dock side follows the selected left or right position.

### Inline Section

Use when:
- Merchant wants an AI shopping block inside the page flow.
- Homepage, collection page, or campaign landing page.

Behavior:
- Assistant appears as a section after the first main content section.
- Bubble is hidden.
- Choice panel is visible by default unless open-on-load is enabled.
- Direct chat can be selected when the merchant wants the inline block to start as a conversation.

### Fullscreen

Use when:
- Merchant wants a direct AI shopping mode.
- Campaigns or guided buying pages.

Behavior:
- Bubble opens chat directly.
- Chat takes most of the viewport.

---

## Content Rules

### Tone

Use:
- Clear.
- Useful.
- Specific.
- Commerce-oriented.
- Premium but not pushy.

Avoid:
- Hype.
- Runtime jargon.
- Vague AI language.
- Claims about revenue or performance without real analytics.

### Labels

Preferred labels:
- `Assistant live`
- `Widget active`
- `Catalog connected`
- `Checkout ready`
- `Widget type`
- `Assistant mode`
- `Quick actions`
- `Open automatically`

Avoid:
- `System Prompt`
- `Runtime`
- `MCP status`
- `UCP layer`
- `Agent Orchestrator`

---

## Current Implementation Notes

Current files:
- Dashboard: `app/routes/app._index.jsx`
- Dashboard styles: `app/styles/intentcart-dashboard.module.css`
- Theme settings: `extensions/chat-bubble/blocks/chat-interface.liquid`
- Widget runtime: `extensions/chat-bubble/assets/chat.js`
- Widget styles: `extensions/chat-bubble/assets/chat.css`
- Merchant config: `app/merchant/`

Current widget modes:
- `bubble`
- `side-panel`
- `inline`
- `fullscreen`

Current config rule:
- Theme Editor settings override merchant JSON for visual storefront behavior.
- Merchant JSON remains the source for durable assistant and commerce defaults until per-shop persistence exists.

---

## Do

- Keep the merchant dashboard simple and operational.
- Show real active states only.
- Keep the widget configurable from Theme Editor.
- Use the dashboard for business behavior and merchant defaults.
- Keep future capabilities visible but not fake-clickable.
- Use product cards and checkout links only from real Shopify results.

## Do Not

- Do not add fake analytics.
- Do not expose raw prompts as the core product interface.
- Do not make the dashboard feel like a landing page.
- Do not make the widget own commerce state.
- Do not add decorative visual systems that compete with the storefront theme.
- Do not use internal architecture language in merchant-facing UI.
