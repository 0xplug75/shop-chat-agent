# Product Positioning

## Status

This document is the canonical product, brand, and market-positioning reference
for the current validation phase. It freezes the strategic foundation agreed on
31 July 2026. Product copy, sales material, research, and roadmap decisions
should remain consistent with it until field evidence justifies a revision.

This freezes the positioning, not the final company or application name.
`Intent Card` remains an internal demo label. `IntentCart` is the current code
and application name. The shopper-facing assistant is named **Sage**.

## Brand promise

> **Turn your Shopify store into an agentic shopping experience.**

Supporting explanation:

> Sage understands what shoppers need, recommends a short list of relevant
> products, explains why they fit, and guides the decision through Shopify
> checkout.

## The problem

Canonical formulation:

> Shopify stores struggle to transform a shopper's naturally expressed need
> into a short, relevant, and reassuring product selection, creating friction
> between purchase intent and the catalog.

Merchant formulation:

> I am paying to bring shoppers to my store, but some leave because they cannot
> find or confidently choose the right product. I cannot reliably distinguish
> that problem from a lack of purchase intent.

Shopper formulation:

> I know what I need, but I do not know which of these products is right for me.

The strategic name for this problem is:

> **The intent-to-catalog gap.**

The problem is not primarily the number of SKUs. It becomes acute when products
are difficult to compare, several criteria must be combined, preferences are
uncertain, a wrong choice has consequences, or choosing the right product
already requires a conversation.

## Category

The focused entry category is:

> **Agentic guided selling for Shopify.**

The long-term architectural vision remains an AI commerce operating layer for
Shopify. That is the destination, not the initial category claim. The initial
product must first prove that it can improve one narrow on-site buying decision.

## Positioning

Short positioning statement:

> Sage helps Shopify brands whose products require advice turn each shopper's
> intent into a confident buying decision.

Differentiation:

> **Not another chatbot. A decision layer between shopper intent and the
> Shopify catalog.**

Operating principle:

> **Sage recommends. Shopify transacts.**

Shopify remains the source of truth for products, prices, variants, inventory,
cart, checkout, policies, orders, and customer commerce state. Sage owns the
conversation, preference elicitation, recommendation explanation, merchant
guardrails, and measurement of the assisted journey.

## Initial experience

The first complete experience is deliberately narrow:

1. A shopper describes a need in natural language.
2. Sage asks only the clarifying questions required to understand the decision.
3. Sage presents a short list of two to four relevant products.
4. Sage explains why each option fits and makes the trade-offs understandable.
5. The shopper refines, compares, or chooses an alternative.
6. Sage confirms product, variant, and quantity.
7. Shopify owns cart state and completes checkout.

The product should help the shopper decide, not merely generate conversational
text or reproduce a traditional search-results page inside a chat window.

## Validation ICP

The initial validation segment is:

> Shopify DTC functional-skincare brands offering several related products or
> routines, receiving recurring pre-purchase questions about which product to
> choose, possessing a sufficiently structured catalog, and having an
> e-commerce team able to measure the effect of guided selling.

This is a validation beachhead, not yet a proven final sales ICP.

Behavioral qualification signals matter more than arbitrary company-size or
catalog-size thresholds:

- shoppers repeatedly ask “which one is right for me?”;
- several products appear similar without expert guidance;
- the brand already uses a quiz, buying guide, live chat, or detailed education;
- pre-purchase support contains repeated product-selection questions;
- the catalog and approved product knowledge are sufficiently structured;
- the merchant has enough traffic and analytics maturity to run a valid test;
- product margin and decision value can justify assisted selling.

The principal buyer is the Head of E-commerce, E-commerce Manager, CRO lead, or
founder responsible for conversion. The operational user is typically an
e-commerce manager, merchandiser, or CX lead. The end user is a shopper who
knows the need but not yet the right product.

## Why functional skincare first

Functional skincare is the first validation terrain because product selection
often combines goals, skin characteristics, ingredients, routines, constraints,
and preference uncertainty. It can therefore reveal whether conversational
preference elicitation creates genuine decision value.

Supplements and nutrition remain exploratory segments, not part of the same
initial beachhead. Their medical, regulatory, interaction, and claims risks make
them a separate market requiring separate evidence and guardrails.

Sage must not claim to diagnose a condition. Approved language includes
understanding needs, eliciting preferences, guiding selection, explaining
differences, and recommending from merchant-approved information.

## What is locked

- Brand promise: “Turn your Shopify store into an agentic shopping experience.”
- Core problem: the intent-to-catalog gap.
- Entry category: agentic guided selling for Shopify.
- Product role: decision layer between shopper intent and Shopify's catalog.
- First surface: an on-site Shopify widget inside the existing storefront.
- Initial value: a short, explained, reassuring product selection.
- Commerce boundary: Sage recommends; Shopify transacts.
- Validation beachhead: functional-skincare Shopify DTC brands.
- The product must preserve merchant voice, approved knowledge, and control.
- Attribution and experimentation are core product capabilities, not optional
  reporting added after launch.

## What is not yet proven

The following remain research hypotheses and must not be presented as facts:

- exact GMV, employee-count, traffic, AOV, margin, or SKU thresholds;
- willingness to pay or a final pricing model;
- a two-to-six-week sales cycle;
- superiority over a well-designed static quiz;
- shopper adoption of a conversational interface;
- a specific conversion uplift, including a 10% uplift;
- reduction in returns;
- acceptable inference and LLM costs at production scale;
- Shopify's long-term boundary around native on-site assistants.

No public promise should include a quantified conversion lift until a valid
merchant experiment demonstrates it.

## Measurement doctrine

Early pilots should instrument the whole assisted-decision journey:

- widget exposure and opening rate;
- engaged conversation rate;
- intent and preference capture;
- recommendation completion;
- product click and comparison behavior;
- add-to-cart after assistance;
- checkout progression;
- purchase conversion;
- expressed purchase confidence;
- unresolved or escalated intents;
- answer accuracy and merchant corrections.

An A/B test must be powered from each merchant's real baseline conversion rate,
minimum detectable effect, traffic, and test duration. A fixed sample of 1,000
sessions cannot be assumed sufficient for a 10% relative conversion lift.

## Anti-ICP for the first launch

Do not initially target:

- one-product or extremely simple catalogs;
- stores where selection does not require advice;
- merchants without enough traffic or measurement capability;
- merchants with poor or unapproved product information;
- low-margin commodity catalogs where assistance costs more than its value;
- use cases dominated by sizing, virtual try-on, or autonomous medical advice;
- merchants seeking only customer-support ticket automation;
- merchants seeking only external-agent visibility or autonomous checkout.

## Message hierarchy

1. **Promise:** Turn your Shopify store into an agentic shopping experience.
2. **Problem:** Close the gap between shopper intent and your catalog.
3. **Outcome:** Help shoppers find and confidently choose the right product.
4. **Mechanism:** Natural-language guidance, short recommendations, and clear
   trade-offs grounded in live Shopify data and approved brand knowledge.
5. **Trust:** Merchant-controlled, transparent, measurable, and handed back to
   Shopify for cart and checkout.

Until quantified evidence exists, the safest outcome-oriented supporting line
is:

> **Help more shoppers find the right product and measure what happens next.**

## Validation gates

Before broadening the product or market, establish evidence for three questions:

1. Do target merchants observe a frequent and economically meaningful product-
   selection problem?
2. Do shoppers engage with guided selling when it appears at the right moment?
3. Does the experience improve an observable outcome such as product discovery,
   purchase confidence, add-to-cart, or conversion?

The next phase is customer and shopper validation, not a broader feature build.
