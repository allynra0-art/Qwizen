import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8, 'Minimal 8 karakter').max(100),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(100),
});

const optText = z.string().trim().min(1).max(100);

export const questionSchema = z
  .object({
    type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'TYPE_ANSWER']),
    text: z.string().trim().min(1).max(300),
    timeLimit: z.number().int().min(5).max(120).default(20),
    points: z.number().int().min(0).max(2000).default(1000),
    explanation: z.string().trim().max(500).default(''),
    options: z.array(optText).min(2).max(4).optional(), // MULTIPLE_CHOICE
    correct: z.union([z.number().int().min(0), z.boolean()]).optional(), // MC: index, TF: boolean
    answers: z.array(optText).min(1).max(5).optional(), // TYPE_ANSWER
  })
  .superRefine((q, ctx) => {
    const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (q.type === 'MULTIPLE_CHOICE') {
      if (!q.options) bad('options', 'Opsi wajib diisi');
      else if (typeof q.correct !== 'number' || q.correct >= q.options.length) bad('correct', 'Jawaban benar tidak valid');
    } else if (q.type === 'TRUE_FALSE') {
      if (typeof q.correct !== 'boolean') bad('correct', 'Pilih Benar atau Salah');
    } else if (!q.answers) bad('answers', 'Isi minimal satu jawaban yang diterima');
  });

export const quizInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(''),
  questions: z.array(questionSchema).max(100).default([]),
});

const pin = z.string().regex(/^\d{6}$/, 'PIN harus 6 angka');
export const hostJoinSchema = z.object({ pin });
export const joinSchema = z.object({
  pin,
  nickname: z.string().trim().min(1, 'Nama belum diisi').max(16, 'Maksimal 16 karakter')
    .regex(/^[\p{L}\p{N} _.\-]+$/u, 'Nama hanya boleh huruf, angka, dan spasi'),
});
export const answerSchema = z.object({
  questionId: z.number().int(),
  answer: z.union([z.number().int().min(0).max(3), z.boolean(), z.string().max(100)]),
});

export const reconnectSchema = z.object({
  pin,
  playerId: z.string().min(1).max(40),
  token: z.string().min(1).max(64),
});
