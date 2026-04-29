import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, BotDocument } from './entities/bot.entity';
import TelegramBot from 'node-telegram-bot-api';

interface TestState {
  qNum: number;
  correct: number;
  wrong: number;
  skip: number;
  answer: number;
  phase: 'idle' | 'question' | 'result';
  timer: NodeJS.Timeout | null;
}

@Injectable()
export class BotService {
  private bot: TelegramBot;
  private sessions: Map<number, TestState> = new Map();

  constructor(@InjectModel(Bot.name) private botModel: Model<BotDocument>) {
    this.bot = new TelegramBot(process.env.BOT_TOKEN as string, {
      polling: true,
    });

    this.bot.setMyCommands([
      { command: '/start', description: 'Matematik testni boshlash' },
    ]);

    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;

      // Foydalanuvchini bazaga saqlash (birinchi marta)
      const found = await this.botModel.findOne({ chatId });
      if (!found) {
        await this.botModel.create({ chatId, name: msg.from?.first_name });
      }

      this.startTest(chatId);
    });

    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;

      // /start buyrug'ini bu yerda qayta ishlamaymiz
      if (!text || text === '/start') return;

      const session = this.sessions.get(chatId);
      if (!session) return;

      if (session.phase === 'question') {
        this.handleAnswer(chatId, text, session);
        return;
      }

      if (session.phase === 'result') {
        this.handleRestart(chatId, text, session);
        return;
      }
    });
  }

  // ─── Test boshlash ───────────────────────────────────────────────
  private startTest(chatId: number) {
    // Eski timer bo'lsa bekor qilish
    const old = this.sessions.get(chatId);
    if (old?.timer) clearTimeout(old.timer);

    const session: TestState = {
      qNum: 0,
      correct: 0,
      wrong: 0,
      skip: 0,
      answer: 0,
      phase: 'idle',
      timer: null,
    };
    this.sessions.set(chatId, session);

    this.bot.sendMessage(
      chatId,
      'Matematik test boshlandi! Sizga 10 ta savol beriladi. Har bir savolga javob berish uchun 10 soniya vaqt bor.',
    );

    setTimeout(() => this.askQuestion(chatId), 1000);
  }

  // ─── Savol berish ────────────────────────────────────────────────
  private askQuestion(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.qNum += 1;
    session.phase = 'question';

    const { text, answer } = this.generateQuestion(session.qNum);
    session.answer = answer;

    this.bot.sendMessage(chatId, text);

    // 10 soniyalik timer
    session.timer = setTimeout(() => {
      this.bot.sendMessage(chatId, '⏰ Vaqt tugadi! Savol o\'tkazib yuborildi.');
      session.skip += 1;
      this.nextStep(chatId);
    }, 10000);
  }

  // ─── Javobni tekshirish ──────────────────────────────────────────
  private handleAnswer(chatId: number, text: string, session: TestState) {
    const num = parseInt(text.trim(), 10);

    // Son emas
    if (isNaN(num) || String(num) !== text.trim()) {
      this.bot.sendMessage(chatId, 'Faqat son kiriting.');
      return;
    }

    // Timerni bekor qilish
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    if (num === session.answer) {
      this.bot.sendMessage(chatId, 'To\'g\'ri ✅');
      session.correct += 1;
    } else {
      this.bot.sendMessage(
        chatId,
        `Noto'g'ri ❌ To'g'ri javob: ${session.answer}`,
      );
      session.wrong += 1;
    }

    this.nextStep(chatId);
  }

  // ─── Keyingi qadam (savol yoki natija) ──────────────────────────
  private nextStep(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    if (session.qNum >= 10) {
      setTimeout(() => this.showResult(chatId), 600);
    } else {
      setTimeout(() => this.askQuestion(chatId), 800);
    }
  }

  // ─── Natijani ko'rsatish ─────────────────────────────────────────
  private showResult(chatId: number) {
    const session = this.sessions.get(chatId);
    if (!session) return;

    session.phase = 'result';
    const percent = Math.round((session.correct / 10) * 100);

    this.bot.sendMessage(
      chatId,
      `Test tugadi!\nSiz 10 ta savoldan ${session.correct} tasiga to'g'ri javob berdingiz.\nNatijangiz: ${percent}%`,
    );

    setTimeout(() => {
      this.bot.sendMessage(chatId, 'Yana ishlashni xohlaysizmi?\nha / yo\'q');
    }, 700);
  }

  // ─── Qayta boshlash yoki chiqish ─────────────────────────────────
  private handleRestart(chatId: number, text: string, session: TestState) {
    const val = text.trim().toLowerCase();

    if (val === 'ha') {
      this.startTest(chatId);
    } else if (val === "yo'q" || val === 'yoq') {
      this.bot.sendMessage(
        chatId,
        "Rahmat! Yana test ishlash uchun /start deb yozing.",
      );
      session.phase = 'idle';
    } else {
      this.bot.sendMessage(chatId, "Iltimos, ha yoki yo'q deb yozing.");
    }
  }

  // ─── Savol generatsiya qilish ────────────────────────────────────
  private generateQuestion(qNum: number): { text: string; answer: number } {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-', '*'] as const;
    const op = ops[Math.floor(Math.random() * 3)];

    let answer: number;
    let symbol: string;

    if (op === '+') {
      answer = a + b;
      symbol = '+';
    } else if (op === '-') {
      answer = a - b;
      symbol = '-';
    } else {
      answer = a * b;
      symbol = '×';
    }

    return {
      text: `${qNum}-savol: ${a} ${symbol} ${b} = ?`,
      answer,
    };
  }
}

