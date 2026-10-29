# Prompt engineering techniques for the P.O.C rewrite step

_Primary sources only. All pages accessed 2026-10-28._

## Summary

All three vendors agree on a small core: say exactly what you want, give the context and purpose behind it, state the output format and length, scope instructions explicitly because current models follow them literally, and separate pasted material from the request. All three also now advise against the old tricks: ALL-CAPS or "CRITICAL" emphasis, "think step by step" on reasoning models, and padding. Every core technique scales down to a single sentence. Templates with headings, roles and few-shot blocks don't scale down, so P.O.C should add them only when the draft already carries enough material to justify them.

Sources, cited below by short name:

- **[A-BP]** Anthropic, [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices). The old `docs.claude.com/.../claude-4-best-practices` URL now redirects here.
- **[A-S5]** Anthropic, [Prompting Claude Sonnet 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5)
- **[O-PE]** OpenAI, [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering). The old `platform.openai.com/docs/guides/prompt-engineering` URL now redirects here.
- **[O-RB]** OpenAI, [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
- **[O-41]** OpenAI Cookbook, [GPT-4.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)
- **[O-G6]** OpenAI, [Using GPT-6](https://developers.openai.com/api/docs/guides/prompt-guidance)
- **[G-PS]** Google, [Prompt design strategies (Gemini API)](https://ai.google.dev/gemini-api/docs/prompting-strategies). This page includes a Gemini 3 section.

## 1. What each vendor recommends

**Anthropic** [A-BP]:
- Be clear and direct. Treat the model as "a brilliant but new employee who lacks context on your norms". The test is whether a colleague with minimal context could follow the prompt.
- Be specific about output format and constraints. If you want more than the task strictly requires, "explicitly request it."
- Give the reason behind an instruction, because "Claude can generalize from the explanation." The example is "never use ellipses *because* text-to-speech can't pronounce them."
- Use examples, 3–5 of them, relevant and diverse, wrapped in `<example>` tags.
- Use XML tags to separate instructions, context, examples and inputs.
- A role in the system prompt, where "even a single sentence makes a difference."
- With 20k+ tokens of input, put the long documents first and the query last. This improved quality "up to 30 percent."
- For format, say what to do rather than what not to do, and match the prompt's style to the output style you want.

**OpenAI:**
- Use message roles. Order a developer message as identity, instructions, examples, then context, with context "usually best positioned near the end" [O-PE].
- Use Markdown headers and lists or XML tags to mark sections [O-PE].
- Use few-shot examples that cover "a diverse range of possible inputs" [O-PE].
- GPT-style models "benefit from very precise instructions". Reasoning models do "better… with only high-level guidance" [O-PE].
- For reasoning models, keep prompts "brief, clear", try zero-shot first, use delimiters, and "give very specific parameters for a successful response" [O-RB].
- Its newest guide says to infer "the user's intent and task scope from the instructions and prior conversation context" [O-G6].

**Google** [G-PS]:
- Give "clear and specific instructions", constraints, and the response format.
- Supply context "instead of assuming that the model has all of the required information."
- "We recommend to always include few-shot examples." Keep them varied and consistently formatted, and don't use too many.
- Break complex tasks into chained prompts.
- For Gemini 3: be "direct, well-structured", define ambiguous terms, use one consistent delimiter style (XML or Markdown), put the role and format first, and put the question last after long context.

## 2. Where they agree, where they differ, and what is outdated

**Core set, endorsed by all three:**

| Technique | Anthropic | OpenAI | Google |
|---|---|---|---|
| Explicit, specific task | [A-BP] | [O-PE], [O-RB] | [G-PS] |
| Context / purpose | [A-BP] | [O-PE] | [G-PS] |
| Explicit output format and length | [A-BP] | [O-RB] | [G-PS] |
| Delimit distinct content | XML [A-BP] | Markdown or XML [O-PE], [O-RB] | XML or Markdown, consistently [G-PS] |
| Long material first, question last | [A-BP] | context near end [O-PE] | [G-PS] |

**Vendor-specific:**

- **Delimiters.** Anthropic prefers XML [A-BP]. OpenAI treats Markdown and XML as equals [O-PE], and its GPT-4.1 guide found that "JSON performed particularly poorly" for documents [O-41]. Google accepts either, as long as one style is used consistently [G-PS]. Plain labels or Markdown are a safe default, because the target can be any of the three chat apps.
- **Few-shot examples.** Google says "always include" them [G-PS]. OpenAI says to try "zero shot first, then few shot if needed" for reasoning models [O-RB]. This is a real conflict. For chat rewrites, follow OpenAI and include an example only when the user supplied one.
- **Role prompts.** Anthropic places the role in the system prompt [A-BP], Google places it at the start [G-PS], and OpenAI includes "identity" in developer messages [O-PE]. None of these pages addresses a role line at the start of a user's chat message. _Unverified: whether a role line adds value in a consumer chat message._

**Outdated or counterproductive on current models:**

- **Aggressive emphasis.** Anthropic says to replace "CRITICAL: You MUST use this tool when…" with "Use this tool when…", because current models overtrigger on it [A-BP]. OpenAI: "not necessary to use all-caps or other incentives like bribes or tips" [O-41]. Google: "Avoid unnecessary or overly persuasive language" [G-PS].
- **Telling the model to reason step by step.** OpenAI says reasoning models reason internally, so the instruction is unnecessary [O-RB]. Google says it is "generally not necessary to have the model outline, plan, or detail reasoning steps" [G-PS]. Anthropic models use adaptive thinking that is "always on" on its newest models [A-BP]. All three chat apps now run reasoning models by default. _Unverified: the default model in each consumer app on a given day._
- **Over-prompting for thoroughness.** Anthropic: "If your prompts previously encouraged the model to be more thorough… reduce that guidance" [A-BP].
- **Relying on inference.** Current models follow instructions literally. Anthropic says the model "does not infer requests you didn't make" [A-S5]. OpenAI says the model follows instructions "more closely and more literally" [O-41]. To apply an instruction broadly, state the scope [A-S5].
- **API-only levers.** Prefill, `temperature` and `budget_tokens` are removed or error on current models [A-BP], [A-S5], [G-PS]. None of them can be set from a chat box anyway.

## 3. What scales down to a 1–4 sentence chat prompt

**Scales down to a clause or a sentence:** a specific deliverable, the purpose or audience, the format and length, the scope, success criteria, and a definition for an ambiguous term. Each costs 5–20 words. Anthropic's own "more effective" example is one sentence longer than the weak version [A-BP].

**Scales down only when material is present:** delimiters and putting material first. If the draft includes pasted text, label it. If it doesn't, adding tags is pure overhead.

**Long-prompt only. Do not add to a short draft:**
- the full section template (role, instructions, steps, format, examples, context) [O-41], [O-PE]
- 3–5 few-shot examples [A-BP]
- prompt chaining [G-PS]
- long-context ordering rules for 20k+ tokens [A-BP]
- detailed anti-Markdown blocks [A-BP]

Anthropic also warns that the prompt's own formatting leaks into the response: "removing markdown from your prompt can reduce the volume of markdown in the output" [A-BP]. A conversational question should stay prose.

## 4. Recommendation for P.O.C

**Apply on every rewrite:**

1. **Name the concrete deliverable.** Say exactly what to produce. Sources: [A-BP] "Be clear and direct", [G-PS], [O-RB].
   _Example:_ "Draft a 3-paragraph cover letter for the FTI Data & Analytics role."
   _Shorten or omit_ when the draft is already a precise factual question.

2. **Add the purpose and audience from the user's answers.** Say why the output is needed and who it is for. Sources: [A-BP] "Add context", [G-PS], [O-PE].
   _Example:_ "…for a hiring manager who skims; I'm a finance student with no consulting experience."
   _Omit_ when there is no real purpose to state. Never invent one.

3. **Specify the format and length.** Sources: [A-BP], [O-RB], [G-PS] (Gemini 3 answers are direct by default unless you ask for more).
   _Example:_ "Answer in under 150 words, as prose."
   _Omit_ when the user's answers show no preference. Don't guess one.

4. **Make the scope and constraints explicit, phrased as what to do.** Current models follow instructions literally. Sources: [A-S5] "More literal instruction following", [O-41], [A-BP] "Tell Claude what to do instead of what not to do", [G-PS] "define ambiguous terms".
   _Example:_ "Apply this tone to every email in the thread, not just the first."
   _Omit_ when there is only one item and no constraints.

5. **State what a good answer looks like.** Give the success criteria. Sources: [O-RB] "very specific parameters for a successful response", [A-BP].
   _Example:_ "A good answer names the two options I should drop and why."
   _Omit_ for simple lookups.

6. **Explain the reason behind any unusual constraint.** Sources: [A-BP] ellipsis example and "Claude can generalize from the explanation".
   _Example:_ "No jargon, since this goes to my parents."
   _Use only_ when the constraint isn't self-explanatory.

7. **Separate pasted material from the request, material first and ask last.** Sources: [A-BP] XML tags and long-context ordering, [O-PE], [G-PS].
   _Example:_ `Text: """…""" ` followed by "Tighten this to 100 words."
   _Omit_ entirely when the draft has no pasted material.

**The rewrite must NOT:**

- **Add ALL-CAPS, "CRITICAL/MUST", threats, tips or bribes.** Sources: [A-BP], [O-41], [G-PS].
- **Add "think step by step" or ask the model to show its reasoning.** Sources: [O-RB], [G-PS], [A-BP] adaptive thinking.
- **Inflate a short prompt into a sectioned template, or add Markdown headers to a conversational ask.** Sources: [O-RB] "brief, clear instructions", [A-BP] "match your prompt style to the output", [G-PS] "direct".
- **Add invented few-shot examples by default.** Sources: [O-RB] zero-shot first, [A-BP] examples must "mirror your actual use case".
- **Rely on implied scope.** If something should apply broadly, the rewrite has to say so. Source: [A-S5].
- **Add "be thorough / be comprehensive / if in doubt, do more" boilerplate.** It causes overtriggering. Source: [A-BP].
- **Add facts, constraints or a purpose the user didn't give.** _This follows from the "add context" guidance plus the product's own design; no vendor states it outright._
- **Use JSON to wrap documents.** Source: [O-41].

_Not verified from a primary source:_ the value of a role line in a user chat message, the default model in each consumer chat app, and anything on the GPT-6 page beyond the quotes above. The fetched summary of that page was thin, and it should be re-read before quoting it further.
