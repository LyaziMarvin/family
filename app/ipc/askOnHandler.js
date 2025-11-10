// app/ipc/askOnHandler.js
const { ipcMain } = require('electron');
const { allAsync } = require('../database/db');
const axios = require('axios');
const { decodeToken } = require('../model/userModel');

// -------- Config (Granite via Ollama-compatible / Embeddings) --------
const SLM_URL = process.env.SLM_URL || 'http://208.109.228.76:11435/api/generate';
const SLM_MODEL = process.env.SLM_MODEL || 'granite3.2:2b';

// ---- Embeddings (Transformers.js) ----
const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID || 'Xenova/all-MiniLM-L6-v2';
// Optional expected dim; if set, we’ll warn when mismatch (but won’t throw)
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 384);

const DEBUG = true;
const MAX_TOKENS_PER_CHUNK = 2000;
const TOKEN_CHAR_RATIO = 4;

// ------------- Naming -------------
// Kept name for backwards-compat with existing collections
function collectionNameForUser(userId) {
  return `user_${userId}_records_all_minilm`;
}

// ----- Utils -----
function safeMsg(e) {
  if (e?.response?.data) try { return JSON.stringify(e.response.data); } catch (_) {}
  return e?.message || String(e);
}

// ---------- Transformers.js lazy loader ----------
let __embedPipeline = null;
async function getEmbedPipeline() {
  if (__embedPipeline) return __embedPipeline;

  // dynamic import so CommonJS works fine
  const { pipeline, env } = await import('@xenova/transformers');

  // enable remote download (first run) and optional local cache
  env.allowRemoteModels = true;
  if (process.env.TRANSFORMERS_CACHE) {
    env.localModelPath = process.env.TRANSFORMERS_CACHE;
  }

  // quantized weights keep it lightweight on CPU
  __embedPipeline = await pipeline('feature-extraction', EMBED_MODEL_ID, { quantized: true });
  if (DEBUG) console.log(`[embeddings] Loaded model: ${EMBED_MODEL_ID}`);
  return __embedPipeline;
}

// -------- Embeddings (Transformers.js) --------
async function embedOne(text) {
  const extractor = await getEmbedPipeline();
  // pooling='mean' -> sentence embedding; normalize=true -> cosine-ready
  const output = await extractor(String(text || ''), { pooling: 'mean', normalize: true });
  const vec = Array.from(output.data || []);
  if (!Array.isArray(vec) || !vec.length) throw new Error('Embedding returned empty vector');

  // Soft sanity check (don’t hard fail)
  if (EMBEDDING_DIM && Number.isFinite(EMBEDDING_DIM) && EMBEDDING_DIM !== vec.length) {
    console.warn(`Embedding dimension mismatch (expected ${EMBEDDING_DIM}, got ${vec.length}). Continuing.`);
  }
  return vec;
}

function splitDocumentIntoChunks(text, maxTokensPerChunk = MAX_TOKENS_PER_CHUNK, ratio = TOKEN_CHAR_RATIO) {
  const maxChars = maxTokensPerChunk * ratio;
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;
    if (end >= text.length) end = text.length;
    else {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0)) || 1;
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0)) || 1;
  return dot / (magA * magB);
}

function extractGraniteStreamedAnswer(rawData) {
  if (!rawData || typeof rawData !== 'string') return 'No answer returned.';
  const lines = rawData.trim().split('\n');
  let answer = '';
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.response) answer += obj.response;
      if (obj.done) break;
    } catch (_) {}
  }
  return answer.trim() || 'No answer returned.';
}

function genOptions() {
  return {
    max_tokens: 512,
    temperature: 0.2,
    top_p: 0.9,
    options: {
      num_predict: 512,
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.25,
      presence_penalty: 0.2,
      frequency_penalty: 0.2,
      stop: ["\n\nCONTEXT:", "\n\nQUESTION:", "\n\nAnswer:", "\n\nContext:"]
    }
  };
}

async function askGranite(prompt, { stream = false, timeout = 600000 } = {}) {
  const body = {
    model: SLM_MODEL,
    prompt,
    stream,
    ...genOptions(),
  };

  if (stream) {
    // streaming with axios + responseType: 'stream' handled by caller
    const resp = await axios.post(SLM_URL, body, { responseType: 'stream', timeout });
    return resp;
  } else {
    const response = await axios.post(SLM_URL, body, { timeout });
    if (DEBUG) console.log('Granite raw response:', response.data?.slice?.(0, 200) || typeof response.data);
    return extractGraniteStreamedAnswer(response.data);
  }
}

// ------------- Legacy scope helpers -------------
async function fetchScopedText(userId, scope) {
  const type = scope?.type || 'all';

  if (type === 'latest') {
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE user_id = ?
        ORDER BY datetime(uploaded_at) DESC, id DESC
        LIMIT 1`,
      [userId]
    );
    const r = rows?.[0];
    if (!r?.extracted_text) return '';
    return `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text}\n`;
  }

  if (type === 'current') {
    const currentId = Number(scope?.id);
    if (!Number.isInteger(currentId)) return '';
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE user_id = ? AND id = ?
        LIMIT 1`,
      [userId, currentId]
    );
    const r = rows?.[0];
    if (!r?.extracted_text) return '';
    return `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text}\n`;
  }

  if (type === 'all') {
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE user_id = ?
        ORDER BY id DESC`,
      [userId]
    );
    if (!rows?.length) return '';
    return rows
      .map((r) => `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text || ''}\n`)
      .join('\n-------------------------\n');
  }

  if (type === 'ids') {
    const cleanIds = Array.isArray(scope?.ids)
      ? scope.ids.map(Number).filter(Number.isInteger)
      : [];
    if (!cleanIds.length) return '';
    const placeholders = cleanIds.map(() => '?').join(',');
    const params = [...cleanIds, userId];
    const rows = await allAsync(
      `SELECT id, file_name, extracted_text
         FROM records
        WHERE id IN (${placeholders}) AND user_id = ?
        ORDER BY id DESC`,
      params
    );
    if (!rows?.length) return '';
    return rows
      .map((r) => `[[${r.file_name || `Record ${r.id}`}]]\n${r.extracted_text || ''}\n`)
      .join('\n-------------------------\n');
  }

  return fetchScopedText(userId, { type: 'all' });
}

// ---------------- Prompts (existing) ----------------
function categoryPrompt(category) {
  switch ((category || '').toLowerCase()) {
    case 'medical':
      return 'Extract medical information: conditions, allergies, medications, and any hospitalizations.';
    case 'profile':
      return 'Summarize the person’s profile including full name, DOB, location, occupation, and education.';
    case 'timeline':
      return 'List important life events in chronological order with approximate dates.';
    case 'relationships':
      return 'Describe the person’s family and social relationships including parents, spouse, children, siblings.';
    case 'family-tree':
    case 'family_tree':
      return 'Generate a family tree in the form A —[relationship]→ B.';
    default:
      return 'Answer the question based on the document text.';
  }
}

// ---------------- Category (online) ----------------
ipcMain.handle('ask:on:category', async (_event, { category, token, scope }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const mergedText = await fetchScopedText(decoded.userId, scope);
    if (!mergedText.trim()) return { success: false, error: 'No document text found' };

    const instructions = `
Your task is to: ${categoryPrompt(category)}
If multiple files are present (marked like [[filename]]), reconcile conflicts sensibly.
Provide only the answer itself. Avoid repetition, be concise.
`;

    const answer = await askGranite(`
Use the following document text to answer. Do not repeat words, avoid stuttering.

${mergedText}

Instruction: ${instructions}
Answer:
`);
    return { success: true, answer };
  } catch (err) {
    console.error('SLM (online) category error:', err.message);
    return { success: false, error: 'Failed to contact Granite API.' };
  }
});

// ---------------- RAG (non-streaming) ----------------
ipcMain.handle('ask:on:question', async (_event, { question, token, scope, topK = 4 }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    const mergedText = await fetchScopedText(decoded.userId, scope);
    if (!mergedText.trim()) {
      return { success: true, answer: 'No document text found.' };
    }

    // chunk, embed chunks, embed query, find topK by cosine sim
    const chunks = splitDocumentIntoChunks(mergedText, MAX_TOKENS_PER_CHUNK);
    const chunkEmbeddings = [];
    for (const c of chunks) {
      try { chunkEmbeddings.push(await embedOne(c)); }
      catch (e) { console.warn('Embedding chunk failed, skipping chunk:', e.message); chunkEmbeddings.push(null); }
    }

    const qEmb = await embedOne(question);

    const scored = [];
    for (let i = 0; i < chunks.length; i++) {
      const emb = chunkEmbeddings[i];
      if (!emb) continue;
      scored.push({ index: i, score: cosineSimilarity(qEmb, emb) });
    }
    if (!scored.length) return { success: true, answer: 'No relevant context found.' };

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map(s => chunks[s.index]);
    const context = top.join('\n---\n');

    const prompt = `Answer the question using ONLY this context. Be concise. Do not repeat words or syllables.

CONTEXT:
${context}

QUESTION: ${question}

Answer:`;

    const answer = await askGranite(prompt);
    return { success: true, answer, sources: top.map((c, i) => ({ chunkPreview: c.slice(0, 240), score: scored[i]?.score })) };
  } catch (err) {
    console.error('SLM (online) Q&A error:', safeMsg(err));
    return { success: false, error: safeMsg(err) };
  }
});

// ---------------- RAG (streaming over IPC) ----------------
ipcMain.on('ask:on:question:stream', async (event, { question, token, scope, topK = 4 }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) {
    event.sender.send('ask:on:question:stream:error', 'Not authenticated');
    return;
  }
  try {
    const mergedText = await fetchScopedText(decoded.userId, scope);
    if (!mergedText.trim()) {
      event.sender.send('ask:on:question:stream:chunk', JSON.stringify({ response: 'No document text found.' }));
      event.sender.send('ask:on:question:stream:chunk', JSON.stringify({ type: 'done' }));
      return;
    }

    // chunk, embed chunks
    const chunks = splitDocumentIntoChunks(mergedText, MAX_TOKENS_PER_CHUNK);
    const chunkEmbeddings = [];
    for (const c of chunks) {
      try { chunkEmbeddings.push(await embedOne(c)); }
      catch (e) { console.warn('Embedding chunk failed, skipping chunk:', e.message); chunkEmbeddings.push(null); }
    }

    const qEmb = await embedOne(question);

    const scored = [];
    for (let i = 0; i < chunks.length; i++) {
      const emb = chunkEmbeddings[i];
      if (!emb) continue;
      scored.push({ index: i, score: cosineSimilarity(qEmb, emb) });
    }
    if (!scored.length) {
      event.sender.send('ask:on:question:stream:chunk', JSON.stringify({ response: 'No relevant context found.' }));
      event.sender.send('ask:on:question:stream:chunk', JSON.stringify({ type: 'done' }));
      return;
    }

    scored.sort((a, b) => b.score - a.score);
    const topIndices = scored.slice(0, topK).map(s => s.index);
    const docs = topIndices.map(i => chunks[i]);
    const metas = topIndices.map((i, idx) => ({
      chunk: i,
      preview: (chunks[i] || '').slice(0, 220),
      score: scored[idx].score
    }));

    // send RAG sources first
    event.sender.send(
      'ask:on:question:stream:chunk',
      JSON.stringify({
        type: 'sources',
        sources: metas
      })
    );

    const body = {
      model: SLM_MODEL,
      prompt: `Answer the question using ONLY this context. Be concise. Do not repeat words or syllables.\n\nCONTEXT:\n${docs.join('\n---\n')}\n\nQUESTION: ${question}\n\nAnswer:`,
      stream: true,
      ...genOptions(),
    };

    const resp = await axios.post(SLM_URL, body, { responseType: 'stream', timeout: 0 });

    resp.data.on('data', (buf) => {
      const s = buf.toString('utf-8');
      if (s) event.sender.send('ask:on:question:stream:chunk', s);
    });
    resp.data.on('end', () => {
      event.sender.send('ask:on:question:stream:chunk', JSON.stringify({ type: 'done' }));
    });
    resp.data.on('error', (e) => {
      event.sender.send('ask:on:question:stream:error', e.message || 'Stream error');
    });
  } catch (e) {
    event.sender.send('ask:on:question:stream:error', safeMsg(e));
  }
});

// ---------------- Auto-query helper (new) ----------------
ipcMain.handle('ask:on:auto', async (_event, { token, scope = { type: 'latest' }, question = 'What is the main topic of this document?', topK = 2 }) => {
  const decoded = decodeToken(token);
  if (!decoded?.userId) return { success: false, error: 'Not authenticated' };

  try {
    // Enforce: default to latest; allow explicit current-id override.
    const effScope = (scope?.type === 'current' && Number.isInteger(Number(scope?.id)))
      ? { type: 'current', id: Number(scope.id) }
      : { type: 'latest' };

    const mergedText = await fetchScopedText(decoded.userId, effScope);
    if (!mergedText.trim()) return { success: false, error: 'No document text found' };

    const chunks = splitDocumentIntoChunks(mergedText, MAX_TOKENS_PER_CHUNK);
    const chunkEmbeddings = [];
    for (const c of chunks) {
      try { chunkEmbeddings.push(await embedOne(c)); }
      catch (e) { console.warn('Embedding chunk failed, skipping chunk:', e.message); chunkEmbeddings.push(null); }
    }

    const qEmb = await embedOne(question);

    const scored = [];
    for (let i = 0; i < chunks.length; i++) {
      const emb = chunkEmbeddings[i];
      if (!emb) continue;
      scored.push({ index: i, score: cosineSimilarity(qEmb, emb) });
    }
    if (!scored.length) return { success: true, autoAnswer: 'No relevant context found.' };

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map(s => chunks[s.index]);
    const context = top.join('\n---\n');

    // non-streamed call for quick first-pass
    const prompt = `Answer the question using ONLY this context:\n${context}\n\nQuestion: ${question}`;
    const answer = await askGranite(prompt, { stream: false });

    return { success: true, autoAnswer: answer };
  } catch (err) {
    console.error('SLM (auto) error:', safeMsg(err));
    return { success: false, error: safeMsg(err) };
  }
});

module.exports = {};
