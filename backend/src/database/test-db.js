import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const dbPath = './database.sqlite';
const db = new sqlite3.Database(dbPath);
const get = promisify(db.get.bind(db));
const all = promisify(db.all.bind(db));

try {
  const employees = await all('SELECT id, name, email, role, (face_data IS NOT NULL) AS is_face_present, LENGTH(face_data) AS face_data_length FROM employees');
  console.log('--- SEEDED EMPLOYEES WITH FACE DATA ---');
  console.log(JSON.stringify(employees, null, 2));
} catch (error) {
  console.error('Error fetching employees:', error);
} finally {
  db.close();
}

