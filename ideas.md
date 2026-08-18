# Amarktai Sales Assistant — Design Directions

## Three Exploratory Approaches

### 1. Signal Garden
**Very Brief Intro:** A bright editorial world where warm citrus, electric coral, and deep ink frame a living stream of sales signals. It makes automation feel human, energetic, and pleasantly decisive.

**Probability:** 0.04

### 2. City Rhythm
**Very Brief Intro:** A high-tempo metropolitan collage combining sunny Johannesburg-inspired hues, stacked type, and candid team photography. It makes the product feel local, bold, and ready for momentum.

**Probability:** 0.07

### 3. Soft Orbit
**Very Brief Intro:** A calm future-facing system of brushed lavender, moonlit blue, and dimensional orbital forms. It makes sales intelligence feel measured and quietly sophisticated.

**Probability:** 0.02

---

# Chosen Direction: Signal Garden

## Design Movement

**New-wave editorial product design** with playful Swiss typography, botanical signal motifs, and art-directed product collage. It uses the confidence of an early-stage consumer brand rather than the conventionally sterile appearance of sales software.

## Core Principles

1. **Momentum is visible.** Layouts should suggest information travelling forward through staggered paths, activity rails, and an asymmetric story arc.
2. **Joy earns attention.** Bright color, surprising microcopy, and hand-cut shapes make the product approachable without reducing its credibility.
3. **Clarity stays in command.** Large statement headlines sit beside compact, legible evidence and clean interaction surfaces.
4. **The product feels in-the-loop.** Art, UI fragments, and copy should communicate a collaborative assistant that acts thoughtfully, not an opaque black box.

## Color Philosophy

The foundational canvas is **deep ink navy**: a grounded, premium place for bright signals to land. **Signal Lime** is the ownable action color, used in only the highest-value moments to imply a lead that is ready to move. **Citrus orange**, **electric coral**, and **sky blue** create a celebratory spectrum for supporting visual stories, while warm cream prevents long reading passages from feeling technical. The color system is energetic, not random; each bright hue denotes movement, conversation, or momentum.

## Layout Paradigm

The page is designed as a **sales signal journey** rather than a regular centered stack of sections. Content follows a slightly offset vertical route: the hero begins with a left-anchored statement and a floating dashboard collage on the right; feature stories alternate their visual gravity; the final action panel pulls users into an unexpected wide field of color. The sign-in screen uses an editorial split composition where security copy occupies a textural side panel and the authentication action has a focused, clean reading column.

## Signature Elements

1. **Signal buds:** rounded lime nodes with short connector stems appear as decorative, conceptual indicators of leads moving forward.
2. **Paper-cut waves:** oversized, soft-edged color blocks overlap content at decisive transition points.
3. **Framed fragments:** small UI snapshots, status chips, and candid imagery are layered with ink outlines and energetic offset shadows.

## Interaction Philosophy

Interactions should feel like an assistant placing something helpful on the desk: direct, immediate, and lightly playful. Buttons press inward with a brief tactile scale. Cards lift a few pixels and reveal a color edge on hover. Navigation scrolls visitors to a clear destination, while the authentication screen gives unmistakable states for an entered and verified code.

## Animation

Use short, spring-like motion with `cubic-bezier(0.23, 1, 0.32, 1)`. Signal buds drift only a few pixels on ambient loops; feature cards enter in a 40–70 ms cascade when they enter the viewport; stars and decorative shapes rotate very slowly. Buttons respond in 100–160 ms. The full experience must respect `prefers-reduced-motion`, removing decorative movement and retaining only necessary feedback states.

## Typography System

**Space Grotesk** handles headlines, labels, and important numeric moments in firm, highly legible weights. **DM Sans** handles all explanatory copy and form UI for an open, effortless reading rhythm. Headlines use tight tracking, high contrast in scale, and occasional italic emphasis; utility text uses deliberate uppercase tracking to create hierarchy without relying on extra borders.

## Brand Essence

**Amarktai Sales Assistant turns every warm signal into a well-timed, human-sounding next move for ambitious teams.**

**Personality:** optimistic, sharp, generous.

## Brand Voice

Copy is direct, spirited, and observant. Headlines celebrate the time and attention recovered; CTAs offer a specific moment of progress. Avoid generic SaaS promises and avoid speaking in vague abstractions.

> “Your pipeline called. It wants momentum.”

> “Give every good lead its best next move.”

## Wordmark & Logo

Use a bold **four-petal signal bloom**: four rounded lime teardrops orbit an ink center, with one petal extended into a small directional arrow. It is graphic, scalable, and deliberately text-free. The adjacent wordmark uses a custom feeling, tightly set Space Grotesk treatment with an orange dot accent; it is never just a default browser font.

## Signature Brand Color

**Signal Lime — `#D8FF3E`**. A bright, distinctive action color that should appear in the logo, key CTAs, active states, and positive status moments.

## Style Decisions

- Imagery uses one unified Amarktai collage language: crafted scenes are always paired with ink framing, offset editorial shadows, lime signal buds, and small UI fragments.
- The page reads as one continuous signal journey. Connector rails, buds, and staggered paths carry energy between major sections instead of appearing only as isolated decoration.
- Product visual moments always show a concrete assistant action, such as a warm signal, context note, draft, reminder, or next-move recommendation.
