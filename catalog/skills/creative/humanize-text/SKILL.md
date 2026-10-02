---
name: humanize-text
description: "Rewrite text to remove AI writing tells while preserving meaning, facts and the author's voice. Covers English and Brazilian Portuguese, each with its own bundled catalogue of language-specific tells. Use when asked to humanize, naturalize or de-AI writing (\"make this sound human\", \"remove the AI voice\", \"less AI-sounding\", \"de-slop this\", \"humanizar texto\", \"tirar cara de IA\", \"deixar mais natural\", \"parecer escrito por humano\"), or when reviewing prose for artificial formality, filler connectives, corporate vocabulary, inflated importance, generic conclusions, em-dash overuse and uniform rhythm."
metadata:
  category: creative
  languages: "en, pt-BR"
  triggers: "humanize, humanise, de-AI, AI slop, AI-sounding, sounds like AI, make it sound human, more natural, less robotic, remove AI voice, rewrite text, edit prose, copy edit, tone of voice, writing style, em dash, English, humanizar, humanizar texto, cara de IA, texto de IA, parecer humano, deixar natural, revisar texto, reescrever texto, português, PT-BR, pt-br, portugues brasileiro, tom de voz, estilo de escrita"
---

# Humanize Text

Remove the signals typical of text written or rewritten by AI. Two language catalogues are
bundled with this skill: English and Brazilian Portuguese.

The goal is not simply to make the text informal. It should read as if a real person wrote it,
with rhythm, word choices, opinions and small natural irregularities appropriate to the context.

Preserve:

* the meaning;
* the facts;
* the intent;
* the appropriate level of formality;
* the author's existing personality.

Do not "polish" the text unnecessarily.

---

# Pick the language catalogue first

Detect the language of the text being rewritten — not the language the user asked in. A user
writing to you in English very often wants a Portuguese text humanized, and vice versa.

Then read the matching file in this skill's directory **before rewriting anything**:

| Language of the text | Read |
| --- | --- |
| English | `references/english.md` |
| Brazilian Portuguese | `references/portugues-br.md` |

Each catalogue is self-contained: the full process, the numbered patterns with look-for/fix
examples in that language, the expressions that deserve special attention, the final checklist
and the output rules. Work from it directly — the tells are language-specific and the examples
do not transfer.

If the text mixes both languages, read both catalogues and apply each to its own passages.

For a language other than these two, say so plainly and fall back to the shared principles
below; do not apply the English or Portuguese word lists to a third language.

---

# Shared principles

These hold in both languages. The catalogue you load expands each one with concrete examples.

## Process

1. Read the whole text before changing anything.
2. Identify the common patterns of AI writing.
3. Rewrite only what sounds artificial, generic or over-organized.
4. Simplify sentences that seem written to sound intelligent.
5. Vary rhythm and sentence length.
6. Preserve the author's natural expressions, even when they are not perfectly formal.
7. Where appropriate, add a position, personality and specificity.
8. Do one last read asking: "Would a real person actually write it this way?"

## Core principle

Human writing is not necessarily informal.

A technical report can be human.
An academic paper can be human.
A two-line message can be human.

The problem is when the text reads as if it came out of a mold.

Avoid flattening everything into casual register. The register should match who is writing and
where the text will be published.

---

# Output

Deliver the rewritten text first.

Don't explain each change.

If asked, follow up with a short summary of the main changes.

Don't say the text was "humanized", "optimized" or "polished".
