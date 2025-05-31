const { addRowToSheet } = require("./google-sheet");

(async () => {
  console.log("🚀 Тест запускается...");

  await addRowToSheet({
    Дата: new Date().toLocaleString("ru-RU"),
    Наименование: "Тестовая покупка",
    Сумма: "123",
    Категория: "Тест",
    Метод: "ручной",
    Примечание: "Проверка",
  });
})();


