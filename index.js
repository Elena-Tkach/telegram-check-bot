require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const { addRowToSheet, getAllRows } = require("./google-sheet");
const Tesseract = require("tesseract.js");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Привет! Отправь мне текст покупки или фото чека."
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // 📸 Обработка фото чека
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);

    const filePath = path.join(__dirname, "receipt.jpg");
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      url: fileLink,
      method: "GET",
      responseType: "stream",
    });
    response.data.pipe(writer);

    writer.on("finish", async () => {
      bot.sendMessage(chatId, "🧠 Распознаю чек...");

      const result = await Tesseract.recognize(filePath, "rus+eng", {
        logger: (m) => console.log(m.status),
      });

      const fullText = result.data.text.toLowerCase();

      const now = new Date().toLocaleString("ru-RU");

      // 1. Поиск суммы
      const totalMatch =
        fullText.match(
          /(итого|всего|total|amount|sum|suma|sumă|оплата|к оплате|до сплати|numerar)[^\d]{0,10}(\d+[.,]?\d{1,2})/i
        ) ||
        fullText.match(
          /(?:^|\n)[^\d]{0,10}(\d{2,6}[.,]\d{2})(?:\s*(₸|тг|лей|lei|\$|€|₽|руб))?/i
        );

      let amount = null;

      if (totalMatch) {
        amount = totalMatch[2]
          ? totalMatch[2].replace(",", ".")
          : totalMatch[1].replace(",", ".");
      }

      // 2. Магазин
      const storeList = [
        "magnum",
        "small",
        "eva",
        "arina",
        "almaz",
        "pharmacy",
        "аптека",
        "a101",
        "carrefour",
      ];
      let store =
        storeList.find((name) => fullText.includes(name)) || "неизвестно";

      // 3. Валюта
      let currency = "lei";
      if (
        fullText.includes("лей") ||
        fullText.includes("mdl") ||
        fullText.includes("lei")
      ) {
        currency = "MDL";
      } else if (fullText.includes("$") || fullText.includes("usd")) {
        currency = "USD";
      } else if (fullText.includes("€") || fullText.includes("eur")) {
        currency = "EUR";
      } else if (fullText.includes("руб") || fullText.includes("₽")) {
        currency = "RUB";
      }

      // 4. Сохраняем
      if (amount) {
        await addRowToSheet({
          Дата: now,
          Наименование: "Чек",
          Сумма: parseFloat(amount).toFixed(2),
          Валюта: currency,
          Категория: store,
          Метод: "чек (OCR)",
          Примечание: "",
        });

        bot.sendMessage(
          chatId,
          `✅ Добавлено: ${amount} ${currency} (${store})`
        );
      } else {
        bot.sendMessage(chatId, "⚠️ Не удалось определить сумму чека.");
      }
    });

    return;
  }

  // ✍️ Обработка текстовой записи вручную
  if (msg.text && !msg.text.startsWith("/")) {
    const now = new Date().toLocaleString("ru-RU");
    const text = msg.text.trim();

    const amountMatch = text.match(
      /(\d+(?:[.,]\d{1,2})?)\s*(тг|тенге|₸|лей|lei|mdl|usd|\$|доллар|eur|€|евро|руб|₽)?/i
    );
    const amount = amountMatch ? amountMatch[1].replace(",", ".") : "";
    const rawCurrency = amountMatch ? amountMatch[2]?.toLowerCase() : "";

    const currencyMap = {
      тг: "KZT",
      тенге: "KZT",
      "₸": "KZT",
      лей: "MDL",
      lei: "MDL",
      mdl: "MDL",
      $: "USD",
      usd: "USD",
      доллар: "USD",
      eur: "EUR",
      евро: "EUR",
      "€": "EUR",
      руб: "RUB",
      "₽": "RUB",
      rub: "RUB",
    };

    const currency = currencyMap[rawCurrency] || "";

    const words = text.split(/\s+/);
    const categoryCandidate =
      words.length > 1 ? words[words.length - 1].toLowerCase() : "";
    const name = amountMatch ? text.slice(0, amountMatch.index).trim() : text;

    await addRowToSheet({
      Дата: now,
      Наименование: name,
      Сумма: amount,
      Валюта: currency,
      Категория: categoryCandidate,
      Метод: "ручной ввод",
      Примечание: "",
    });

    bot.sendMessage(
      chatId,
      `✅ Добавлено в таблицу: ${amount} ${currency} (${categoryCandidate})`
    );
  }
});

cron.schedule("0 10 * * 0", async () => {
  const chatId = process.env.REPORT_CHAT_ID; // создадим переменную в .env
  if (!chatId) return;

  const rows = await getAllRows();

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const filtered = rows.filter((row) => {
    const rawDate = row["Дата"];
    if (!rawDate) return false;

    // Берём только дату, если есть время — отсечём по запятой
    const [datePart] = rawDate.split(",");
    const [day, month, year] = datePart.trim().split(".");
    if (!day || !month || !year) return false;

    // Преобразуем в ISO-формат, чтобы new Date сработал
    const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
    if (isNaN(parsedDate)) return false;

    return parsedDate >= startOfWeek;
  });

  if (filtered.length === 0) {
    await bot.sendMessage(chatId, "📊 За прошлую неделю расходов не было.");
    return;
  }

  let total = 0;
  const byCategory = {};

  for (const row of filtered) {
    const sum = parseFloat(row["Сумма"]);
    const cat = row["Категория"] || "неизвестно";
    if (!byCategory[cat]) byCategory[cat] = 0;
    byCategory[cat] += sum;
    total += sum;
  }

  let text = `🧾 Отчёт за неделю (${startOfWeek.toLocaleDateString()} — ${new Date().toLocaleDateString()}):\n\n`;
  text += `Общие расходы: ${total.toFixed(2)}\n\n`;

  for (const [cat, sum] of Object.entries(byCategory)) {
    text += `— ${cat}: ${sum.toFixed(2)}\n`;
  }

  await bot.sendMessage(chatId, text);
});

// 🕙 Автоматический отчёт каждое воскресенье в 10:00 (UTC+3)
cron.schedule("0 7 * * 0", async () => {
  console.log("⏰ Время отправить автоматический отчёт...");

  try {
    const rows = await getAllRows(); // импортируй функцию, если нужно
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const filtered = rows.filter(row => {
      const rawDate = row["Дата"];
      if (!rawDate) return false;

      const [datePart] = rawDate.split(",");
      const [day, month, year] = datePart.trim().split(".");
      if (!day || !month || !year) return false;

      const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
      if (isNaN(parsedDate)) return false;

      return parsedDate >= startOfWeek;
    });

    const totals = {};
    let totalAmount = 0;

    filtered.forEach(row => {
      const category = row["Категория"] || "неизвестно";
      const amount = parseFloat(row["Сумма"]) || 0;
      totals[category] = (totals[category] || 0) + amount;
      totalAmount += amount;
    });

    let message = `🧾 Автоотчёт за неделю (${startOfWeek.toLocaleDateString()} — ${now.toLocaleDateString()}):\n\n`;
    message += `Общие расходы: ${totalAmount.toFixed(2)}\n\n`;

    for (const [category, sum] of Object.entries(totals)) {
      message += `— ${category}: ${sum.toFixed(2)}\n`;
    }

    await bot.sendMessage(process.env.REPORT_CHAT_ID, message);
    console.log("✅ Автоотчёт отправлен");
  } catch (error) {
    console.error("❌ Ошибка при автоотчёте:", error);
  }
});


bot.onText(/\/отчет-неделя/, async (msg) => {
  const chatId = msg.chat.id;
  const rows = await getAllRows();

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const filtered = rows.filter(row => {
  const rawDate = row["Дата"];
  if (!rawDate) return false;

  // Берём только дату, если есть время — отсечём по запятой
  const [datePart] = rawDate.split(",");
  const [day, month, year] = datePart.trim().split(".");
  if (!day || !month || !year) return false;

  // Преобразуем в ISO-формат, чтобы new Date сработал
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
  if (isNaN(parsedDate)) return false;

  return parsedDate >= startOfWeek;
});


  if (filtered.length === 0) {
    await bot.sendMessage(chatId, "📊 За прошлую неделю расходов не было.");
    return;
  }

  let total = 0;
  const byCategory = {};

  for (const row of filtered) {
    const sum = parseFloat(row["Сумма"]);
    const cat = row["Категория"] || "неизвестно";
    if (!byCategory[cat]) byCategory[cat] = 0;
    byCategory[cat] += sum;
    total += sum;
  }

  let text = `🧾 Отчёт за неделю (${startOfWeek.toLocaleDateString()} — ${new Date().toLocaleDateString()}):\n\n`;
  text += `Общие расходы: ${total.toFixed(2)}\n\n`;

  for (const [cat, sum] of Object.entries(byCategory)) {
    text += `— ${cat}: ${sum.toFixed(2)}\n`;
  }

  await bot.sendMessage(chatId, text);
});
