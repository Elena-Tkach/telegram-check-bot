const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = require("./google-credentials.json");

const SHEET_ID = "1A5QKZNgSElcKpyQQY9ejaLH-GmXe_JKOg27uTFJQ2DY"; // без лишнего

async function addRowToSheet(row) {
  console.log("📄 Подключаюсь к таблице...");
  const doc = new GoogleSpreadsheet(SHEET_ID);

  try {
    await doc.useServiceAccountAuth(creds);
    console.log("✅ Авторизация прошла успешно");
  } catch (error) {
    console.error("❌ Ошибка авторизации:", error);
    return;
  }

  try {
    await doc.loadInfo();
    console.log("📊 Загружен документ:", doc.title);
  } catch (error) {
    console.error("❌ Ошибка загрузки документа:", error);
    return;
  }

  try {
    const sheet = doc.sheetsByTitle["Покупки"];
    if (!sheet) {
      console.error("❌ Лист 'Покупки' не найден. Проверь название в таблице.");
      return;
    }
    console.log("📄 Добавляю строку:", row);
    await sheet.addRow(row);
    console.log("✅ Строка успешно добавлена!");
  } catch (error) {
    console.error("❌ Ошибка при добавлении строки:", error);
  }
}

async function getAllRows() {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["Покупки"];
  const rows = await sheet.getRows();
  return rows;
}


module.exports = { addRowToSheet, getAllRows };




