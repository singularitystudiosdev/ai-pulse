// Keyword gate, ordered CAT3 → CAT1 → CAT2 → CAT4 (spec §2). "Our robot uses a
// new VLM" must land in 3, not 1. Query provenance is NOT a classifier.
import { CATEGORIES } from './config.mjs';

const CAT3_TERMS = ['robot', 'humanoid', 'drone', 'quadruped', 'robot arm', 'self-driving', 'autonomous driving', 'waymo', 'boston dynamics', 'unitree', 'optimus', 'exoskeleton', 'lidar', 'actuator', 'dexterity', 'embodied'];
const CAT1_TERMS = ['claude', 'gemini', 'llama', 'deepseek', 'qwen', 'mistral', 'grok', 'kimi', 'glm', 'weights', 'open-sourced', 'open sourced', 'checkpoint', 'benchmark', 'sota', 'outperforms', 'tokenizer', 'finetuning', 'fine-tuning', 'fine-tuned', 'evals', 'leaderboard', 'base model', 'vlm', 'llm'];
const CAT2_TERMS = ['launch', 'launched', 'launching', 'just shipped', 'shipped', 'we built', 'we made', 'we released', 'out of beta', 'waitlist', 'sign up', 'try it', 'free tier', 'pricing', 'mcp server', 'now available', 'early access', 'publicly available', 'product hunt'];

const regexOf = (terms) => new RegExp(`\\b(${terms.map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})\\b`, 'i');
const CAT3 = { cat: 3, re: regexOf([...CAT3_TERMS, 'figure 0?\\d']), terms: CAT3_TERMS };
const CAT1 = { cat: 1, re: regexOf([...CAT1_TERMS, 'gpt[- ]?[0-9o]', 'phi-', 'beats .{0,20}(on|at) ']), terms: CAT1_TERMS };
const CAT2 = { cat: 2, re: regexOf([...CAT2_TERMS, 'yc s\\d{2}', 'y ?combinator']), terms: CAT2_TERMS };

// Returns {category, matched} — matched = up to 2 keywords for the reason line.
export function classify(text) {
  const t = String(text || '');
  for (const { cat, re, terms } of [CAT3, CAT1, CAT2]) {
    if (re.test(t)) {
      const matched = terms.filter((k) => t.toLowerCase().includes(k)).slice(0, 2);
      return { category: cat, matched };
    }
  }
  return { category: 4, matched: [] };
}

export function catLabel(cat) {
  const c = CATEGORIES[cat];
  return c ? `${c.emoji} ${c.name}` : `cat ${cat}`;
}
