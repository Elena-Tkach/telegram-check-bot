const { GoogleSpreadsheet } = require("google-spreadsheet");

const SHEET_ID = process.env.SPREADSHEET_ID;

const creds = {
  client_email: process.env.EMAIL,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
};

async function addRowToSheet(data) {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle["Покупки"];
  await sheet.addRow(data);
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