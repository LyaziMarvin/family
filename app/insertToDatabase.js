// insertToDatabase.js
const { runAsync } = require('./database/db');

async function insertRecord(data, userId) {
  const result = await runAsync(
    `INSERT INTO records (user_id, extracted_text, extracted_json)
     VALUES (?, ?, ?)`,
    [userId, data.text || '', data.summary || '{}']
  );

  // runAsync doesn't return lastInsertRowid directly; 
  // better to fetch last row explicitly if you need it:
  const lastId = result?.lastInsertRowid || null;
  return lastId;
}

module.exports = { insertRecord };
