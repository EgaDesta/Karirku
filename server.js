import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_INSTRUCTION = `Kamu KarirKU, konsultan karier dan CV yang ramah untuk fresh graduate di Indonesia (termasuk lulusan SMK). Jawab dalam Bahasa Indonesia yang santai, singkat, dan praktis. Gali profil pengguna dengan maksimal 1-2 pertanyaan per giliran, beri rekomendasi karier beserta alasannya, dan jika diminta susun draf CV (jangan mengarang data, beri tanda [isi di sini] untuk info yang belum ada).`;

if (!API_KEY) {
  console.error('GEMINI_API_KEY belum diisi. Salin file .env.example menjadi .env lalu isi key kamu.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Kirim "messages" sebagai array riwayat pesan.' });
    }

    const contents = messages
      .filter((m) => (m?.role === 'user' || m?.role === 'model') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, parts: [{ text: m.content }] }));

    if (contents.length === 0) {
      return res.status(400).json({ error: 'Tidak ada pesan yang valid untuk diproses.' });
    }

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.8,
        maxOutputTokens: 1024,
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