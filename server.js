import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 4;
const RECENT_TURNS_WITH_FILES = 4;
const BASE64_PREFIX = /^data:[^;]+;base64,/;

const ALLOWED_MIME = [
  /^image\/(png|jpeg|jpg|webp|gif|heic|heif)$/,
  /^application\/pdf$/,
  /^text\/(plain|csv|markdown)$/,
];

const SYSTEM_INSTRUCTION = `Kamu KarirKU, konsultan karier dan CV yang ramah untuk fresh graduate di Indonesia (termasuk lulusan SMK). Jawab dalam Bahasa Indonesia yang santai, singkat, dan praktis. Gali profil pengguna dengan maksimal 1-2 pertanyaan per giliran, beri rekomendasi karier beserta alasannya, dan jika diminta susun draf CV (jangan mengarang data, beri tanda [isi di sini] untuk info yang belum ada).

Pengguna bisa melampirkan berkas seperti foto CV, portofolio, atau sertifikat. Manfaatkan lampiran tersebut: kalau ada foto CV, baca isinya lalu beri catatan perbaikan yang konkret. Kalau lampirannya belum relevan dengan topik, tanya pengguna maksudnya. Jangan mengarang isi berkas yang tidak terbaca.`;

if (!API_KEY) {
  console.error('GEMINI_API_KEY belum diisi. Salin file .env.example menjadi .env lalu isi key kamu.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const app = express();

app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeFiles(raw) {
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, MAX_FILES_PER_MESSAGE).flatMap((f) => {
    if (!f || typeof f !== 'object') return [];
    if (!ALLOWED_MIME.some((re) => re.test(f.mimeType || ''))) return [];

    let data = typeof f.data === 'string' ? f.data : '';
    if (BASE64_PREFIX.test(data)) data = data.slice(data.indexOf(',') + 1);
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(data)) return [];
    if (Math.ceil((data.length * 3) / 4) > MAX_FILE_BYTES) return [];

    return [{ mimeType: f.mimeType, data, name: typeof f.name === 'string' ? f.name.slice(0, 120) : 'berkas' }];
  });
}

function toGeminiContents(messages) {
  const start = Math.max(0, messages.length - RECENT_TURNS_WITH_FILES);

  return messages.map((m, i) => {
    const parts = [];
    if (m.content) parts.push({ text: m.content });

    // Lampiran lama dibuang supaya token tidak meledak; teksnya tetap jadi konteks.
    if (i < start && m.files?.length) {
      parts.push({ text: `[Pengguna terlampir: ${m.files.map((f) => f.name).join(', ')}]` });
    } else {
      for (const f of m.files || []) {
        parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
      }
    }

    return { role: m.role, parts };
  });
}

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Kirim "messages" sebagai array riwayat pesan.' });
    }

    const cleaned = messages
      .filter((m) => (m?.role === 'user' || m?.role === 'model') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content, files: normalizeFiles(m.files) }));

    if (cleaned.length === 0) {
      return res.status(400).json({ error: 'Tidak ada pesan yang valid untuk diproses.' });
    }

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: toGeminiContents(cleaned),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.8,
        maxOutputTokens: 2048,
      },
    });

    const reply = response.text?.trim();
    if (!reply) {
      return res.status(502).json({ error: 'Model tidak mengembalikan jawaban. Coba lagi.' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('Error saat memanggil Gemini:', err?.message || err);
    const msg = err?.message || 'Gagal menghubungi Gemini.';
    const clientError = /API key|invalid|permission|401|403/i.test(msg);
    res.status(clientError ? 401 : 500).json({
      error: clientError
        ? 'API key tidak valid atau belum punya akses ke model ini.'
        : 'Maaf, terjadi kesalahan di server. Coba lagi sebentar.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`KarirKU jalan di http://localhost:${PORT} (model: ${MODEL})`);
});