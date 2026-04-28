# Tasker Landing Page: Live Demo Section

## Context

Tasker is a self-hosted NLP task manager. The current landing page has a hero ("Let Tasker remember it.") and three feature blocks (Absolute Privacy, Simplicity, Frictionless Entry). The problem: the page never shows what Tasker actually looks like or how the NLP input works. Users have to sign up to find out.

We're adding one section between the hero and the feature blocks that solves both problems at once.

## What We're Building

A single interactive section with:

1. **A mockup of the Tasker dashboard** rendered in actual HTML/CSS (not a screenshot). It mimics the real dashboard: a task list on the left, an input panel on the right, a couple of example task cards.

2. **A theme switcher** above the mockup with three pills: `cyber`, `solar`, `ember` (names tentative, pick what fits). Clicking a pill re-skins the entire mockup live: colors, fonts, task marker styles, everything.

3. **A typewriter animation in the input box** that cycles through 3-5 example inputs. It types out something like `gym next monday 7am legs, blue` character by character, pauses, then a parsed task card slides into the task list with the right color/date/time. Then it erases and does the next example.

The whole thing is one section. The theme switcher and the typewriter are not separate features, they share the same mockup.

## The Three Themes

The user will provide three screenshots of the actual dashboard in each theme. Look at them carefully. The themes are NOT just color swaps, they have real typographic and structural differences:

- **Theme 1 (cyber/purple)**: monospace font for timestamps and metadata, purple primary accent, badge-style counters, terminal-leaning vibe. The date reads `MON, APR 27` in caps mono. Tasks have a colored side-bar (left border) as the visual marker.

- **Theme 2 (solar/yellow)**: cleaner saas-style dark mode, yellow accent, sentence case ("Your Tasks"), more conventional. Softer typography, no left side-bar on task cards.

- **Theme 3 (ember/orange)**: serif headings (real serif, this is the biggest differentiator), italic dates, warm orange accent, bullet dot markers on tasks instead of side-bars. Has a personality quote box on the side ("It works on my machine. Ship my machine."). Warmest, most editorial feel.

When implementing, these differences MUST come through. If all three themes use the same font and just swap accent color, we've failed. The fonts and marker styles are the soul of each theme.

## Implementation Approach

- Build the mockup as actual HTML/CSS, not screenshots. This is what makes the live re-skin work.
- Use CSS custom properties (`--bg`, `--accent`, `--font-display`, `--font-mono`, etc.) and flip a `data-theme` attribute on the mockup wrapper to switch themes. One stylesheet, three theme blocks.
- Match the existing landing page's tech stack and styling conventions. Read the current landing page code first to see what's already there (tailwind? plain css? what fonts are loaded?).
- Typewriter is pure animation theater. Hardcode 4-5 input/output example pairs in JS. Never call a real LLM from the landing page.
- Typewriter loop: type input (~50ms per char), pause ~400ms, slide parsed task card into list, pause ~2s, erase, repeat with next example.
- Keep the whole thing as one self-contained component/section that can be dropped into the landing page.

## Build Order

1. Static mockup frame in one theme first (start with cyber since it's the most visually distinct). Get the layout pixel-tight before adding anything dynamic.
2. Add the other two themes purely via CSS variables. Manually toggle `data-theme` in devtools to verify each one looks right.
3. Add the theme switcher pills, wire up the toggle.
4. Add the typewriter animation last. Timing is fiddly, expect to iterate.
5. Drop the section into the landing page between the hero and the three feature blocks.

## Things to Avoid

- Don't use the three screenshots as image swaps. The whole point is live re-skinning of the same DOM.
- Don't make the typewriter call the real backend. Pure frontend animation.
- Don't make the three themes just color swaps. Fonts and markers must change too.
- Don't over-engineer. This is one section on a marketing page, not a separate app.

## Reference Screenshots

The user will point you to three screenshots showing each theme in the actual product. Use them as ground truth for fonts, spacing, accent colors, marker styles, and layout. The mockup on the landing page should feel unmistakably like each of those three views, not a generic dashboard with the colors changed.
